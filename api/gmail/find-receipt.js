import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { refreshAccessToken, gmailSearch, gmailGetMessage, parseMessage } from '../_lib/google.js';
import { parseBody } from '../_lib/http.js';

// For a mystery transaction, search every connected inbox for the matching
// receipt, let Claude read the candidates and explain what it was for, then
// save that detail (and the best envelope) back onto the transaction.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
    return;
  }

  try {
    const body = parseBody(req);
    const admin = getSupabaseAdmin();

    let tx = body.transaction;
    if (body.transactionId && !tx) {
      const { data } = await admin
        .from('budget_transactions')
        .select('id, date, description, amount')
        .eq('id', body.transactionId)
        .maybeSingle();
      tx = data;
    }
    if (!tx) {
      res.status(400).json({ error: 'Provide a transaction or transactionId.' });
      return;
    }

    const { data: accounts } = await admin.from('gmail_accounts').select('email, refresh_token');
    const usable = (accounts || []).filter((a) => a.refresh_token);
    if (usable.length === 0) {
      res.status(400).json({ error: 'No Gmail accounts are connected yet.' });
      return;
    }

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

    if (candidates.length === 0) {
      res.status(200).json({ found: false, detail: null, searched: usable.length });
      return;
    }

    const { data: stateRow } = await admin.from('app_state').select('budget').eq('id', 'main').maybeSingle();
    const categories = (stateRow?.budget?.categories || []).filter((c) => c.id !== 'needs-review');

    const client = new Anthropic({ apiKey });
    const model = process.env.CATEGORIZER_MODEL || 'claude-opus-5';
    const catList = categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');
    const emailList = candidates
      .map(
        (c, i) =>
          `--- Email ${i + 1} (inbox: ${c.account}) ---\nFrom: ${c.from}\nSubject: ${c.subject}\nDate: ${c.date}\nBody: ${c.body}`
      )
      .join('\n\n');

    const system = `You match a bank transaction to its email receipt and explain what it was for.
Given the transaction and some candidate emails, find the one that is the receipt / order confirmation for this exact charge (its total should match the amount, and its date should be near the transaction date). If none of them match, say found=false.
Respond with ONLY JSON, no prose or code fences:
{"found": boolean, "detail": string, "categoryId": string or null, "emailSubject": string or null}
- "detail": a short human summary of what was actually purchased, e.g. "Apple: iCloud+ 2TB storage (monthly)" or "Amazon: HDMI cable + phone case".
- "categoryId": the best-fitting envelope id from the list, or null if unclear.`;

    const userMsg = `Transaction: amount=$${tx.amount}, date=${tx.date}, description=${JSON.stringify(tx.description)}\n\nEnvelopes:\n${catList}\n\nCandidate emails:\n${emailList}\n\nReturn the JSON now.`;

    const response = await client.messages.create({
      model,
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const result = parseJsonObject(text);

    if (result?.found && tx.id) {
      const update = {};
      if (result.detail) update.note = String(result.detail).slice(0, 500);
      if (result.categoryId && categories.some((c) => c.id === result.categoryId)) {
        update.category_id = result.categoryId;
      }
      if (Object.keys(update).length > 0) {
        await admin.from('budget_transactions').update(update).eq('id', tx.id);
      }
    }

    res.status(200).json({
      found: !!result?.found,
      detail: result?.detail || null,
      categoryId: result?.categoryId || null,
      emailSubject: result?.emailSubject || null,
    });
  } catch (err) {
    console.error('find-receipt failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Receipt lookup failed.' });
  }
}

// A bank descriptor like "SQ *BLUE BOTTLE 0123" is noisy — keep the first few
// alphabetic words as search keywords.
function cleanMerchant(desc) {
  return String(desc || '')
    .replace(/[^a-zA-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .join(' ');
}

// Gmail date filter for a +/- N day window around the transaction date.
function dateWindow(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = (dt) => `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
  const after = new Date(d);
  after.setDate(after.getDate() - days);
  const before = new Date(d);
  before.setDate(before.getDate() + days);
  return `after:${fmt(after)} before:${fmt(before)}`;
}

function parseJsonObject(text) {
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
