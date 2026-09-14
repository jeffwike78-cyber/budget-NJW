import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { reconcileItem } from '../_lib/syncTransactions.js';
import { parseBody, plaidErrorMessage } from '../_lib/http.js';

export const config = { maxDuration: 60 };

// Transaction audit: compare every imported (Plaid) transaction against the
// bank's live feed and find rows the bank no longer has — the duplicate
// phantoms left behind when a pending charge posted under a new id after a past
// cursor reset. POST { dryRun: true } to preview what would be removed; POST
// { dryRun: false } to actually delete them. Only ever touches source='plaid'
// rows; manual entries, receipts, and splits are left alone.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = parseBody(req);
    const dryRun = body.dryRun !== false; // default to a safe preview
    const itemId = body.itemId || body.item_id || null;

    const plaid = getPlaidClient();
    const admin = getSupabaseAdmin();

    let query = admin.from('plaid_items').select('id');
    if (itemId) query = query.eq('id', itemId);
    const { data: rows, error } = await query;
    if (error) throw error;

    const removed = [];
    const errors = {};
    for (const row of rows || []) {
      try {
        const result = await reconcileItem(admin, plaid, row.id, { dryRun });
        removed.push(...result.removed);
      } catch (itemErr) {
        console.error(`reconcile failed for item ${row.id}:`, itemErr?.response?.data ?? itemErr?.message ?? itemErr);
        errors[row.id] = plaidErrorMessage(itemErr, 'This bank could not be audited.');
      }
    }

    // Newest first — easiest to eyeball against the bank's recent activity.
    removed.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const failed = Object.values(errors);
    res.status(200).json({
      ok: failed.length === 0,
      dryRun,
      count: removed.length,
      removed,
      errors,
      error: failed.length ? `Couldn’t audit ${failed.length} of your banks: ${[...new Set(failed)].join(' ')}` : undefined,
    });
  } catch (err) {
    console.error('reconcile failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Transaction audit failed.') });
  }
}
