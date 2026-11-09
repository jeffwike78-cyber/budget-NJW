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

  // Amazon (and a few others) charge PER SHIPMENT, not per order: one order can
  // post as several bank charges days apart, and no single email total equals a
  // given charge. For those we cast a wider net — an order-confirmation email
  // predates the shipment charge by days, item lists are long, and there may be
  // several shipment notices to line up — then have the AI match this charge to
  // the specific line item(s) it paid for. See the prompt below.
  const splitShipment = isSplitShipmentMerchant(tx.description);
  const daysBefore = splitShipment ? 14 : 7;
  const daysAfter = splitShipment ? 3 : 7;
  const perInbox = splitShipment ? 8 : 4;
  const bodyLimit = splitShipment ? 6000 : 2000;
  const query = `${merchantSearchTerm(tx.description)} ${dateWindow(tx.date, daysBefore, daysAfter)}`.trim();

  const candidates = [];
  for (const acct of usable) {
    try {
      const accessToken = await refreshAccessToken(acct.refresh_token);
      const msgs = await gmailSearch(accessToken, query, perInbox);
      for (const m of msgs.slice(0, perInbox)) {
        const parsed = parseMessage(await gmailGetMessage(accessToken, m.id));
        candidates.push({
          account: acct.email,
          from: parsed.from,
          subject: parsed.subject,
          date: parsed.date,
          body: parsed.body.slice(0, bodyLimit),
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

  const splitNote = splitShipment
    ? `

IMPORTANT — this is an Amazon-style merchant that CHARGES PER SHIPMENT, not per order. A single order often posts as SEVERAL separate bank charges (one per shipment), so the order total is usually LARGER than this one charge, and MULTIPLE unrelated orders in the window can each contain a subset of items that happens to sum near this amount. A near-sum is NOT proof — matching the wrong order's items is the main failure here, and it produces absurd results (a wall light tagged "snacks"). Be conservative:
- STRONGLY PREFER a shipment/dispatch email ("your package has shipped", "shipped", "out for delivery", "dispatched") whose shipment total matches the amount within ~$1 AND that lists the exact items in that shipment. Read the items from THAT shipment. This is the only high-confidence path.
- Only fall back to subset-matching an order-confirmation's itemized list when exactly one subset of items (plus its share of tax/shipping) matches within ~$1 AND no other email in the window could plausibly produce this amount. This is at best low confidence.
- If more than one email/order/subset could match, if the items and their prices are not actually listed, or you are inferring, set found=false. Do NOT guess — leaving it for the person to categorize is far better than a wrong category.
- "detail" names the SPECIFIC item(s) this charge covers (not the whole order), e.g. "Amazon: USB-C cable + phone case (1 of 3 shipments, $${Number(tx.amount).toFixed(2)})".`
    : '';

  const system = `You match a bank transaction to its email receipt and explain what it was for.
Given the transaction and some candidate emails, find the one that is genuinely the receipt / order confirmation for THIS exact charge (its total matches the amount and its date is near the transaction date). If nothing clearly matches, say found=false — a false match is worse than no match.${splitNote}
Respond with ONLY JSON, no prose or code fences:
{"found": boolean, "detail": string, "categoryId": string or null, "business": boolean, "confidence": "high" | "low", "emailSubject": string or null}
- "detail": a short human summary of the ACTUAL items on the matched receipt, e.g. "Apple: iCloud+ 2TB storage (monthly)" or "Amazon: HDMI cable + phone case".
- "categoryId": the envelope id whose name best fits what was ACTUALLY purchased (read the item names — a wall light is not a snack). If the items don't clearly fit one envelope, or you're unsure what the items are, use null rather than force-fitting.
- "business": true ONLY if the receipt shows a clear business or rental-property expense; otherwise false.
- "confidence": "high" only when this email is unmistakably this charge's receipt (e.g. an exact shipment-total match with the items plainly listed) AND the category clearly fits those items. Otherwise "low". When unsure between two possible orders, that is "low".`;

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
    // "high" only when the match and category are unmistakable; anything else
    // is "low" so callers can keep the detail as a hint but not auto-apply the
    // category (which is where wrong Amazon matches did real damage).
    confident: result.confidence === 'high',
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

// Big retailers show up on statements under codes that don't appear in their
// receipt emails — Amazon especially ("AMZN Mktp US*2A3B4", "Amazon.com*BC7"),
// so a keyword search on the raw descriptor finds nothing. Map those known
// merchants to the brand name their emails actually use; fall back to the
// generic keyword cleaner for everything else.
const KNOWN_MERCHANTS = [
  [/amazon|amzn/i, 'Amazon'],
  [/wal-?mart|wm supercenter/i, 'Walmart'],
  [/\btarget\b/i, 'Target'],
  [/costco/i, 'Costco'],
  [/kroger/i, 'Kroger'],
  [/paypal/i, 'PayPal'],
  [/instacart/i, 'Instacart'],
  [/doordash/i, 'DoorDash'],
];
export function merchantSearchTerm(desc) {
  const s = String(desc || '');
  for (const [re, term] of KNOWN_MERCHANTS) {
    if (re.test(s)) return term;
  }
  return cleanMerchant(s);
}

// Merchants that bill per shipment rather than per order, so one order can post
// as several bank charges and no single email total matches a given charge.
// These get a wider email search and the subset-of-items matching in the prompt.
const SPLIT_SHIPMENT_MERCHANTS = [/amazon|amzn/i];
export function isSplitShipmentMerchant(desc) {
  const s = String(desc || '');
  return SPLIT_SHIPMENT_MERCHANTS.some((re) => re.test(s));
}

// Gmail date filter for a window around the transaction date. Symmetric by
// default; pass a separate `after` to look further back than forward (a
// shipment charge posts days AFTER the order-confirmation email).
export function dateWindow(dateStr, before, after = before) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = (dt) => `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
  const afterDate = new Date(d);
  afterDate.setDate(afterDate.getDate() - before);
  const beforeDate = new Date(d);
  beforeDate.setDate(beforeDate.getDate() + after);
  return `after:${fmt(afterDate)} before:${fmt(beforeDate)}`;
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
