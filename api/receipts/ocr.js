import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { parseBody } from '../_lib/http.js';

export const config = { maxDuration: 60 };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Reads a photo of a receipt and RETURNS the extracted fields (merchant, date,
// amount, summary, best envelope) for the user to review in the add form — it
// does NOT create a transaction. The image is stashed in the receipts bucket and
// its path is returned so it can be attached when the user taps Add.
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
    // A capable vision model by default — receipts are messy. Override with OCR_MODEL.
    const model = process.env.OCR_MODEL || 'claude-opus-5';
    const catList = categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');
    const system = `You extract structured data from a photo of a purchase receipt. Read it carefully — merchant name, the date, and especially the GRAND TOTAL (the final amount charged, after tax/tip, not a subtotal or an individual line item).
Respond with ONLY JSON, no prose or code fences:
{"merchant": string, "date": "YYYY-MM-DD" or null, "amount": number, "summary": string, "categoryId": string or null}
- amount = the grand total as a positive number.
- summary = a short, comma-separated list of the actual items purchased (read the line items), e.g. "milk, eggs, paper towels". If items aren't legible, give a brief description.
- categoryId = the best-fitting envelope id from the list, or null if unclear.`;
    const userContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: dataBase64 } },
      { type: 'text', text: `Envelopes:\n${catList}\n\nExtract the receipt JSON now.` },
    ];

    const response = await client.messages.create({
      model,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = parseJsonObject(text) || {};

    const amount = Math.abs(Number(parsed.amount)) || 0;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : null;
    const merchant = String(parsed.merchant || '').slice(0, 120);
    const categoryId =
      parsed.categoryId && categories.some((c) => c.id === parsed.categoryId) ? parsed.categoryId : null;

    // Stash the image so it can be attached when the transaction is created.
    const path = `pending/${randomUUID()}.jpg`;
    await admin.storage.from('receipts').upload(path, Buffer.from(dataBase64, 'base64'), {
      contentType: mediaType,
      upsert: true,
    });

    res.status(200).json({ ok: true, merchant, amount, date, categoryId, summary: parsed.summary || null, receiptPath: path });
  } catch (err) {
    console.error('receipt ocr failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Receipt scan failed.' });
  }
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
