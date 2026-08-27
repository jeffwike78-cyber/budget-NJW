import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { parseBody } from '../_lib/http.js';

export const config = { maxDuration: 30 };

// Uploads a receipt file (sent as base64) to the private 'receipts' bucket and
// records its path on the transaction.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = parseBody(req);
    const { transactionId, filename, contentType, dataBase64 } = body;
    if (!transactionId || !dataBase64) {
      res.status(400).json({ error: 'Missing transactionId or file data.' });
      return;
    }

    const admin = getSupabaseAdmin();
    const ext = (filename && filename.includes('.') ? filename.split('.').pop() : 'jpg').toLowerCase().slice(0, 5);
    const path = `${transactionId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(dataBase64, 'base64');

    const { error: upErr } = await admin.storage
      .from('receipts')
      .upload(path, buffer, { contentType: contentType || 'application/octet-stream', upsert: true });
    if (upErr) throw upErr;

    const { error: updErr } = await admin
      .from('budget_transactions')
      .update({ receipt_path: path })
      .eq('id', transactionId);
    if (updErr) throw updErr;

    res.status(200).json({ ok: true, path });
  } catch (err) {
    console.error('receipt upload failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Upload failed.' });
  }
}
