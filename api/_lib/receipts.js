import Anthropic from '@anthropic-ai/sdk';
import { refreshAccessToken, gmailSearch, gmailGetMessage, parseMessage } from './google.js';

// Search every connected inbox for a transaction's receipt and have Claude
// extract what it was for (and whether it's a business expense). Returns the
// extracted result WITHOUT writing to the DB — the caller decides what to save.
export async function lookupReceiptForTx(admin, tx, categories, { apiKey, model } = {}) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');

  const { data: accounts } = await admin.from('gmail_accounts').select('email, refresh_token');
  const usable = (accounts || []).filter((a) => a.refresh_token);
  if (usable.length === 0) return { found: false, reason: 'no-accounts' };

  const query = `${cleanMerchant(tx.description)} ${dateWindow(tx.date, 7)}`.trim();

  const candidates = [];
  for (const acct of usable) {
    try {
      const accessToken = await refreshAccessToken(acct.refresh_token);
      const msgs = await gmailSearch(accessToken, query, 4);
      for (const m of msgs.slice(0, 4)) {
        const parsed = parseMessage(await gmailGetMessage(accessToken, m.id));
        candidates.push({
          account: acct.email,
          from: parsed.from,
          subject: parsed.subject,
          date: parsed.date,
          body: parsed.body.slice(0, 2000),
        });
      }
    } catch (err) {
      console.error(`Gmail search failed for ${acct.email}:`, err.message);
    }
  }
  if (candidates.length === 0) return { found: false, reason: 'no-candidates' };

  const client = new Anthropic({ apiKey: key });
  const useModel = model || process.env.CATEGORIZER_MODEL || 'claude-opus-5';
  const catList = categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');
  const emailList = candidates
    .map(
      (c, i) =>
        `--- Email ${i + 1} (inbox: ${c.account}) ---\nFrom: ${c.from}\nSubject: ${c.subject}\nDate: ${c.date}\nBody: ${c.body}`
    )
    .join('\n\n');

  const system = `You match a bank transaction to its email receipt and explain what it was for.
Given the transaction and some candidate emails, find the one that is the receipt / order confirmation for this exact charge (its total should match the amount, and its date should be near the transaction date). If none match, say found=false.
Respond with ONLY JSON, no prose or code fences:
{"found": boolean, "detail": string, "categoryId": string or null, "business": boolean, "emailSubject": string or null}
- "detail": a short human summary of what was purchased, e.g. "Apple: iCloud+ 2TB storage (monthly)" or "Amazon: HDMI cable + phone case".
- "categoryId": the best-fitting envelope id from the list, or null if unclear.
- "business": true ONLY if the receipt shows a clear business or rental-property expense; otherwise false.`;

  const userMsg = `Transaction: amount=$${tx.amount}, date=${tx.date}, description=${JSON.stringify(tx.description)}\n\nEnvelopes:\n${catList}\n\nCandidate emails:\n${emailList}\n\nReturn the JSON now.`;

  const response = await client.messages.create({
    model: useModel,
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const result = parseJsonObject(text) || {};

  return {
    found: !!result.found,
    detail: result.detail || null,
    categoryId: result.categoryId || null,
    business: !!result.business,
    emailSubject: result.emailSubject || null,
  };
}

// A bank descriptor like "SQ *BLUE BOTTLE 0123" is noisy — keep the first few
// alphabetic words as search keywords.
export function cleanMerchant(desc) {
  return String(desc || '')
    .replace(/[^a-zA-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .join(' ');
}

// Gmail date filter for a +/- N day window around the transaction date.
export function dateWindow(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = (dt) => `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
  const after = new Date(d);
  after.setDate(after.getDate() - days);
  const before = new Date(d);
  before.setDate(before.getDate() + days);
  return `after:${fmt(after)} before:${fmt(before)}`;
}

export function parseJsonObject(text) {
  const trimmed = (text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
