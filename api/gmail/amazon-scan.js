import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { lookupReceiptForTx, isSplitShipmentMerchant } from '../_lib/receipts.js';

export const config = { maxDuration: 60 };

// How many Amazon charges to chase per run, and how to pace them. Each lookup
// searches both inboxes and makes one AI call, so we cap the batch and stop
// before the 60s function limit — the UI says how many are left to run again.
const MAX_SCAN = 15;
const CONCURRENCY = 3;
const TIME_BUDGET_MS = 50000;

// Bulk-pull Amazon (and other split-shipment) receipts from the connected
// inboxes and write the item detail + best envelope onto the matching
// transactions, so they don't have to be chased one by one. Scans every
// still-unreviewed Amazon charge that's missing a note or a category — not just
// the handful the sync chases automatically.
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
    const admin = getSupabaseAdmin();

    const { count: inboxCount } = await admin.from('gmail_accounts').select('id', { count: 'exact', head: true });
    if (!inboxCount) {
      res.status(400).json({ error: 'No Gmail accounts are connected yet. Connect an inbox in Settings first.' });
      return;
    }

    const { data: stateRow } = await admin.from('app_state').select('budget').eq('id', 'main').maybeSingle();
    const categories = (stateRow?.budget?.categories || []).filter((c) => c.id !== 'needs-review');

    // Candidate Amazon charges: not ignored, not yet user-reviewed, and still
    // missing detail (uncategorized/needs-review OR no note explaining it).
    const { data: rows } = await admin
      .from('budget_transactions')
      .select('id, date, description, amount, category_id, note, user_reviewed, excluded')
      .eq('excluded', false)
      .order('date', { ascending: false })
      .limit(500);
    const candidates = (rows || []).filter(
      (t) =>
        isSplitShipmentMerchant(t.description) &&
        Number(t.amount) > 0 &&
        !t.user_reviewed &&
        (t.category_id === 'needs-review' || !t.category_id || !t.note)
    );
    const batch = candidates.slice(0, MAX_SCAN);

    const started = Date.now();
    let matched = 0;
    let applied = 0;
    let scanned = 0;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (tx) => {
          scanned += 1;
          try {
            const r = await lookupReceiptForTx(admin, tx, categories);
            if (!r.found) return;
            matched += 1;
            const update = {};
            if (r.detail) update.note = String(r.detail).slice(0, 500);
            if (r.categoryId && categories.some((c) => c.id === r.categoryId)) update.category_id = r.categoryId;
            if (r.business) update.business = true;
            if (Object.keys(update).length > 0) {
              await admin.from('budget_transactions').update(update).eq('id', tx.id);
              applied += 1;
            }
          } catch (err) {
            console.error('amazon-scan item failed:', err?.message || err);
          }
        })
      );
    }

    res.status(200).json({
      ok: true,
      scanned,
      matched,
      applied,
      remaining: Math.max(0, candidates.length - scanned),
    });
  } catch (err) {
    console.error('amazon-scan failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Amazon receipt scan failed.' });
  }
}
