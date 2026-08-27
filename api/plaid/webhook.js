import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { syncItem } from '../_lib/syncTransactions.js';
import { parseBody } from '../_lib/http.js';

// Plaid calls this URL directly (not the browser) when new transactions are
// ready. It is exempt from the site password in middleware.ts — Plaid has no
// password to send, and this endpoint only re-pulls from Plaid using tokens
// already stored server-side, so it exposes nothing to a caller.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }
  try {
    const body = parseBody(req);
    const relevant =
      body.webhook_type === 'TRANSACTIONS' &&
      ['SYNC_UPDATES_AVAILABLE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE', 'DEFAULT_UPDATE'].includes(body.webhook_code);

    if (relevant && body.item_id) {
      const admin = getSupabaseAdmin();
      const plaid = getPlaidClient();
      const { data: item } = await admin
        .from('plaid_items')
        .select('id')
        .eq('item_id', body.item_id)
        .maybeSingle();
      if (item) await syncItem(admin, plaid, item.id);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('webhook failed:', err?.response?.data ?? err?.message ?? err);
    // Still return 200 so Plaid doesn't aggressively retry a broken sync.
    res.status(200).json({ ok: false });
  }
}
