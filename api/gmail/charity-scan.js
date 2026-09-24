import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { refreshAccessToken, gmailSearch, gmailGetMessage, parseMessage } from '../_lib/google.js';
import { parseJsonObject } from '../_lib/receipts.js';
import { parseBody } from '../_lib/http.js';

export const config = { maxDuration: 60 };

const CHARITY_QUERY =
  '(donation OR donate OR "tax-deductible" OR "tax deductible" OR "thank you for your gift" OR "your generous gift" OR "your contribution" OR "charitable" OR "donation receipt" OR "gift receipt" OR 501c3 OR tithe OR tithing)';

function ymd(d) {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function daysApart(a, b) {
  return Math.abs((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
}

// Scour connected inboxes for charitable-donation receipts in a calendar year,
// have Claude extract the real ones, and match each to an existing transaction.
// READ-ONLY: returns a review list; the client applies what the user approves.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
    return;
  }
  try {
    const body = parseBody(req);
    const year = String(body.year || new Date().getFullYear() - 1).slice(0, 4);
    const admin = getSupabaseAdmin();

    const { data: accounts } = await admin.from('gmail_accounts').select('email, refresh_token');
    const usable = (accounts || []).filter((a) => a.refresh_token);
    if (usable.length === 0) {
      res.status(400).json({ error: 'No Gmail accounts are connected yet.' });
      return;
    }

    const after = ymd(new Date(Number(year), 0, 1));
    const before = ymd(new Date(Number(year) + 1, 0, 1));
    const query = `${CHARITY_QUERY} after:${after} before:${before}`;

    const candidates = [];
    for (const acct of usable) {
      try {
        const accessToken = await refreshAccessToken(acct.refresh_token);
        const msgs = await gmailSearch(accessToken, query, 20);
        for (const m of msgs.slice(0, 20)) {
          const parsed = parseMessage(await gmailGetMessage(accessToken, m.id));
          candidates.push({ from: parsed.from, subject: parsed.subject, date: parsed.date, body: parsed.body.slice(0, 2500) });
        }
      } catch (err) {
        console.error(`Charity scan Gmail search failed for ${acct.email}:`, err.message);
      }
    }
    if (candidates.length === 0) {
      res.status(200).json({ year, found: [] });
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.CATEGORIZER_MODEL || 'claude-opus-5';
    const emailList = candidates
      .map((c, i) => `--- Email ${i + 1} ---\nFrom: ${c.from}\nSubject: ${c.subject}\nDate: ${c.date}\nBody: ${c.body}`)
      .join('\n\n');

    const system = `You extract CHARITABLE DONATION RECEIPTS from emails for a family's tax records.
Include ONLY emails that confirm an actual donation the family MADE to a charity/church/nonprofit — a receipt or acknowledgment with an amount. INCLUDE tax-deductible gift receipts, church tithes, donation confirmations.
EXCLUDE fundraising appeals/solicitations asking for money, newsletters, event invitations, pledges with no payment, political contributions unless clearly a 501(c)(3), and anything without a specific dollar amount.
Respond with ONLY JSON, no prose or code fences:
{"donations": [{"org": string, "date": "YYYY-MM-DD", "amount": number, "emailSubject": string, "deductible": boolean}]}
- "org": the charity/organization name.
- "amount": the donation amount in dollars (a positive number).
- "date": the donation/receipt date.
Return an empty array if none qualify.`;

    const userMsg = `Year: ${year}\n\nCandidate emails:\n${emailList}\n\nReturn the JSON now.`;
    const response = await client.messages.create({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: userMsg }] });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = parseJsonObject(text) || {};
    let donations = Array.isArray(parsed.donations) ? parsed.donations : [];

    // De-dupe identical (org + amount + date) donations from multiple emails.
    const seen = new Set();
    donations = donations.filter((d) => {
      const amt = Number(d.amount);
      if (!(amt > 0) || !d.date) return false;
      const key = `${String(d.org || '').trim().toLowerCase()}|${amt.toFixed(2)}|${d.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Match each donation to an existing transaction in that year (same amount
    // within a small tolerance, within ~10 days), so the user can one-tap tag it.
    const { data: yearTx } = await admin
      .from('budget_transactions')
      .select('id, date, amount, description, tax_category, excluded')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`);
    const pool = (yearTx || []).filter((t) => Number(t.amount) > 0 && !t.excluded);

    const found = donations.map((d) => {
      const amt = Number(d.amount);
      let match = null;
      let best = Infinity;
      for (const t of pool) {
        const da = Math.abs(Number(t.amount) - amt);
        if (da > 0.5) continue;
        const dd = daysApart(t.date, d.date);
        if (dd > 10) continue;
        const score = da * 10 + dd;
        if (score < best) {
          best = score;
          match = t;
        }
      }
      return {
        org: d.org || 'Charity',
        date: d.date,
        amount: amt,
        emailSubject: d.emailSubject || null,
        deductible: d.deductible !== false,
        matchTxId: match ? match.id : null,
        alreadyTagged: match ? match.tax_category === 'charitable' : false,
      };
    });

    res.status(200).json({ year, found });
  } catch (err) {
    console.error('charity-scan failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Charity scan failed.' });
  }
}
