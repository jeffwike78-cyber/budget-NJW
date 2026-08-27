import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { parseBody } from '../_lib/http.js';

// Returns a short-lived signed URL for viewing a stored receipt.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = parseBody(req);
    let path = body.path;
    const admin = getSupabaseAdmin();

    if (!path && body.transactionId) {
      const { data } = await admin
        .from('budget_transactions')
        .select('receipt_path')
        .eq('id', body.transactionId)
        .maybeSingle();
      path = data?.receipt_path;
    }
    if (!path) {
      res.status(404).json({ error: 'No receipt on file.' });
      return;
    }

    const { data, error } = await admin.storage.from('receipts').createSignedUrl(path, 3600);
    if (error) throw error;
    res.status(200).json({ url: data.signedUrl });
  } catch (err) {
    console.error('receipt url failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Could not get receipt link.' });
  }
}
