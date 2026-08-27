import { categorizeTransactions } from './categorizeCore.js';
import { loadBudget, setAccountBalance, setPlaidStatus } from './appState.js';

// Confidence below this and the transaction lands in "Needs Review" instead of
// being auto-filed — so only things the AI is unsure about need a human look.
const CONFIDENCE_THRESHOLD = 0.6;

// Decide a category for each new/changed transaction:
//   1. a merchant the user has corrected before (merchantMemory) → reuse it
//   2. otherwise ask the AI (one batched call) and take confident answers
//   3. anything left over → 'needs-review'
async function assignCategories(supabaseAdmin, changed) {
  const budget = await loadBudget(supabaseAdmin);
  const merchantMemory = budget.merchantMemory || {};
  const categories = (budget.categories || []).filter((c) => c.id !== 'needs-review');
  const validIds = new Set(categories.map((c) => c.id));

  const assignments = {};
  const toAI = [];
  for (const txn of changed) {
    const desc = (txn.merchant_name || txn.name || '').trim();
    const remembered = merchantMemory[desc.toLowerCase()];
    if (remembered && validIds.has(remembered)) {
      assignments[txn.transaction_id] = remembered;
    } else {
      toAI.push({ id: txn.transaction_id, description: desc, amount: txn.amount });
    }
  }

  if (toAI.length > 0 && process.env.ANTHROPIC_API_KEY && categories.length > 0) {
    try {
      const results = await categorizeTransactions({
        transactions: toAI,
        categories,
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      for (const r of results) {
        const confident = typeof r?.confidence !== 'number' || r.confidence >= CONFIDENCE_THRESHOLD;
        if (r?.categoryId && r.categoryId !== 'needs-review' && validIds.has(r.categoryId) && confident) {
          assignments[String(r.id)] = r.categoryId;
        }
      }
    } catch (err) {
      console.error('AI categorize during sync failed:', err?.message || err);
    }
  }

  return assignments; // missing entries fall back to 'needs-review' at upsert time
}

async function syncBalance(supabaseAdmin, plaid, item) {
  const { data } = await plaid.accountsBalanceGet({ access_token: item.access_token });
  const total = data.accounts.reduce((sum, a) => sum + (a.balances.available ?? a.balances.current ?? 0), 0);
  await setAccountBalance(supabaseAdmin, item.account_id, total);
}

// Pulls whatever changed since the stored cursor (everything, on first run),
// auto-categorizes, upserts added/modified, deletes removed, saves the cursor.
// A per-item lock (with a 2-minute stale timeout) stops overlapping webhook
// deliveries from double-importing the same first batch.
export async function syncItem(supabaseAdmin, plaid, itemRowId) {
  const staleThreshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('plaid_items')
    .update({ syncing: true, sync_started_at: new Date().toISOString() })
    .eq('id', itemRowId)
    .or(`syncing.eq.false,sync_started_at.lt.${staleThreshold}`)
    .select();
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    return { synced: 0, removed: 0, skipped: true };
  }
  const item = claimed[0];

  try {
    let cursor = item.sync_cursor;
    const added = [];
    const modified = [];
    const removed = [];
    let hasMore = true;

    while (hasMore) {
      const resp = await plaid.transactionsSync({ access_token: item.access_token, cursor: cursor || undefined });
      added.push(...resp.data.added);
      modified.push(...resp.data.modified);
      removed.push(...resp.data.removed);
      hasMore = resp.data.has_more;
      cursor = resp.data.next_cursor;
    }

    const changed = [...added, ...modified];
    const assignments = await assignCategories(supabaseAdmin, changed);

    for (const txn of changed) {
      const { error } = await supabaseAdmin.from('budget_transactions').upsert(
        {
          plaid_transaction_id: txn.transaction_id,
          date: txn.date,
          description: txn.merchant_name || txn.name,
          amount: txn.amount, // Plaid: positive = money out, matches this app's convention
          category_id: assignments[txn.transaction_id] || 'needs-review',
          account_id: item.account_id,
          source: 'plaid',
        },
        { onConflict: 'plaid_transaction_id' }
      );
      if (error) console.error('Failed to upsert transaction:', error);
    }

    for (const txn of removed) {
      const { error } = await supabaseAdmin
        .from('budget_transactions')
        .delete()
        .eq('plaid_transaction_id', txn.transaction_id);
      if (error) console.error('Failed to delete removed transaction:', error);
    }

    await supabaseAdmin.from('plaid_items').update({ sync_cursor: cursor }).eq('id', itemRowId);

    try {
      await syncBalance(supabaseAdmin, plaid, item);
    } catch (err) {
      console.error('Failed to sync balance:', err?.response?.data ?? err?.message ?? err);
    }

    await setPlaidStatus(supabaseAdmin, itemRowId, { linked: true, lastSyncedAt: new Date().toISOString() });

    return { synced: changed.length, removed: removed.length };
  } finally {
    await supabaseAdmin.from('plaid_items').update({ syncing: false }).eq('id', itemRowId);
  }
}
