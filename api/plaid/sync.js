import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { syncItem } from '../_lib/syncTransactions.js';
import { setPlaidStatus } from '../_lib/appState.js';
import { parseBody, plaidErrorMessage } from '../_lib/http.js';

export const config = { maxDuration: 60 };

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

    // Sync each linked bank independently: one broken connection (e.g. Plaid's
    // "no valid accounts were found for this item" when a login needs
    // reconnecting) must not abort the whole sync and block the healthy banks.
    // Record the failing item's error so the Accounts page can flag it, and
    // keep going.
    const results = {};
    const errors = {};
    for (const row of rows || []) {
      try {
        results[row.id] = await syncItem(admin, plaid, row.id);
      } catch (itemErr) {
        const message = plaidErrorMessage(itemErr, 'This bank could not be synced.');
        const code = itemErr?.response?.data?.error_code || null;
        console.error(`sync failed for item ${row.id}:`, itemErr?.response?.data ?? itemErr?.message ?? itemErr);
        errors[row.id] = message;
        try {
          await setPlaidStatus(admin, row.id, {
            lastError: message,
            lastErrorCode: code,
            lastErrorAt: new Date().toISOString(),
          });
        } catch (statusErr) {
          console.error('Failed to record bank sync error:', statusErr?.message || statusErr);
        }
      }
    }

    const failed = Object.values(errors);
    res.status(200).json({
      ok: failed.length === 0,
      results,
      errors,
      // A single combined message for the client to show. The healthy banks
      // still synced; this only names what didn't.
      error: failed.length ? `Couldn’t sync ${failed.length} of your banks: ${[...new Set(failed)].join(' ')} Try reconnecting it on the Accounts page.` : undefined,
    });
  } catch (err) {
    console.error('sync failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Sync failed.') });
  }
}
