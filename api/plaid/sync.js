import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { syncItem } from '../_lib/syncTransactions.js';
import { parseBody, plaidErrorMessage } from '../_lib/http.js';

// Manual "Sync now" trigger. Pass { itemId } to refresh one bank, or nothing
// to refresh every linked bank.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = parseBody(req);
    const itemId = body.itemId || body.item_id || null;

    const plaid = getPlaidClient();
    const admin = getSupabaseAdmin();

    let query = admin.from('plaid_items').select('id');
    if (itemId) query = query.eq('id', itemId);
    const { data: rows, error } = await query;
    if (error) throw error;

    const results = {};
    for (const row of rows || []) {
      results[row.id] = await syncItem(admin, plaid, row.id);
    }

    res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('sync failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Sync failed.') });
  }
}
