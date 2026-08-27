import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { parseBody } from '../_lib/http.js';

export const config = { maxDuration: 60 };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Reads a photo of a receipt, extracts merchant/date/amount/summary + a best
// envelope, and creates a PENDING transaction (source='receipt') that counts
// against its envelope immediately — later auto-linked to the real bank charge.
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
    const { dataBase64 } = body;
    if (!dataBase64) {
      res.status(400).json({ error: 'Missing image data.' });
      return;
    }
    const mediaType = IMAGE_TYPES.includes(body.contentType) ? body.contentType : 'image/jpeg';

    const admin = getSupabaseAdmin();
    const { data: stateRow } = await admin.from('app_state').select('budget').eq('id', 'main').maybeSingle();
    const categories = (stateRow?.budget?.categories || []).filter((c) => c.id !== 'needs-review');

    const client = new Anthropic({ apiKey });
    const model = process.env.CATEGORIZER_MODEL || 'claude-opus-5';
    const catList = categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');
    const system = `You read a photo of a purchase receipt and extract structured data.
Respond with ONLY JSON, no prose or code fences:
{"merchant": string, "date": "YYYY-MM-DD" or null, "amount": number, "summary": string, "categoryId": string or null}
- amount = the receipt grand total, a positive number.
- summary = a short description of what was bought (e.g. "groceries + household").
- categoryId = the best-fitting envelope id from the list, or null if unclear.`;
    const userContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: dataBase64 } },
      { type: 'text', text: `Envelopes:\n${catList}\n\nExtract the receipt JSON now.` },
    ];

    const response = await client.messages.create({
      model,
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = parseJsonObject(text) || {};

    const amount = Math.abs(Number(parsed.amount)) || 0;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : todayStr();
    const description = String(parsed.merchant || 'Receipt').slice(0, 120);
    const categoryId =
      parsed.categoryId && categories.some((c) => c.id === parsed.categoryId) ? parsed.categoryId : 'needs-review';

    const { data: inserted, error: insErr } = await admin
      .from('budget_transactions')
      .insert({
        date,
        description,
        amount,
        category_id: categoryId,
        account_id: 'receipt',
        source: 'receipt',
        note: String(parsed.summary || '').slice(0, 500),
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    const txId = inserted.id;

    // Store the image and link it to the new transaction.
    const ext = mediaType.split('/')[1] || 'jpg';
    const path = `${txId}/${Date.now()}.${ext}`;
    await admin.storage.from('receipts').upload(path, Buffer.from(dataBase64, 'base64'), {
      contentType: mediaType,
      upsert: true,
    });
    await admin.from('budget_transactions').update({ receipt_path: path }).eq('id', txId);

    res.status(200).json({ ok: true, id: txId, merchant: description, amount, date, categoryId, summary: parsed.summary || null });
  } catch (err) {
    console.error('receipt ocr failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Receipt scan failed.' });
  }
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseJsonObject(text) {
  const t = (text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
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
