import { categorizeTransactions } from './categorizeCore.js';
import { lookupReceiptForTx } from './receipts.js';
import { loadBudget, upsertPlaidAccounts, setPlaidStatus } from './appState.js';

// One budget account per Plaid account. Its id is derived from the Plaid
// account id so transactions and balances can be routed to it without an
// extra lookup table.
function budgetAccountId(plaidAccountId) {
  return `plaid-${plaidAccountId}`;
}
function mapAccountType(a) {
  if (a.type === 'credit') return 'credit';
  if (a.type === 'investment' || a.type === 'brokerage') return 'investing';
  if (a.subtype === 'savings' || a.subtype === 'money market' || a.subtype === 'cd') return 'savings';
  return 'checking';
}
function accountBalance(a) {
  // Credit: current = amount owed. Depository: available cash (falls back to current).
  if (a.type === 'credit') return Number(a.balances?.current ?? 0);
  return Number(a.balances?.available ?? a.balances?.current ?? 0);
}

// Confidence below this and the transaction lands in "Needs Review" instead of
// being auto-filed — so only things the AI is unsure about need a human look.
const CONFIDENCE_THRESHOLD = 0.6;
// Cap on how many still-unclear transactions we chase receipts for per sync,
// to bound cost and stay under the function time limit.
const MAX_RECEIPT_LOOKUPS = 10;

// Decide a category (and business flag) for each new/changed transaction:
//   1. a merchant the user has corrected before (merchantMemory) → reuse it
//   2. otherwise ask the AI (one batched call) and take confident answers
//   3. anything left over → 'needs-review'
async function assignCategories(supabaseAdmin, changed, categories) {
  const budget = await loadBudget(supabaseAdmin);
  const merchantMemory = budget.merchantMemory || {};
  const validIds = new Set(categories.map((c) => c.id));

  const assignments = {};
  const businessSet = new Set();
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
        if (r?.business) businessSet.add(String(r.id));
        const confident = typeof r?.confidence !== 'number' || r.confidence >= CONFIDENCE_THRESHOLD;
        if (r?.categoryId && r.categoryId !== 'needs-review' && validIds.has(r.categoryId) && confident) {
          assignments[String(r.id)] = r.categoryId;
        }
      }
    } catch (err) {
      console.error('AI categorize during sync failed:', err?.message || err);
    }
  }

  return { assignments, businessSet }; // missing assignment → 'needs-review' at upsert
}

function daysApart(aStr, bStr) {
  return Math.abs((new Date(`${aStr}T00:00:00`) - new Date(`${bStr}T00:00:00`)) / 86400000);
}

// The earliest transaction date to import (YYYY-MM-DD), so linking a bank
// doesn't pull years of history. Prefer an explicit settings.importSince;
// otherwise start on the first of the ledger's start month; null = no cutoff.
function importCutoff(budget) {
  const s = budget.settings || {};
  if (typeof s.importSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.importSince)) return s.importSince;
  if (typeof s.startMonth === 'string' && /^\d{4}-\d{2}$/.test(s.startMonth)) return `${s.startMonth}-01`;
  return null;
}

// Money moving between your own accounts, and paying off the credit card, are
// NOT spending — counting them would double-count (the card purchases already
// hit their envelopes) or make an envelope look overspent. Plaid tags these,
// so we auto-mark them Ignored. Note we deliberately DON'T exclude all
// LOAN_PAYMENTS — a mortgage or auto-loan payment is a real budget expense;
// only the credit-card-payment detail is a transfer of already-counted money.
const EXCLUDE_PRIMARY = new Set(['TRANSFER_IN', 'TRANSFER_OUT']);
function isTransferOrCardPayment(txn) {
  const pfc = txn.personal_finance_category || {};
  if (pfc.primary && EXCLUDE_PRIMARY.has(pfc.primary)) return true;
  if (pfc.detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return true;
  // Fallback for accounts/data without a personal-finance category.
  const legacy = Array.isArray(txn.category) ? txn.category.join(' ') : '';
  if (/\btransfer\b/i.test(legacy)) return true;
  if (/credit card payment|card payment/i.test(legacy)) return true;
  return false;
}

// Merge scanned "pending" receipts (source='receipt') into the matching real
// bank charge once it posts: copy the receipt's note/photo/category onto the
// bank transaction and delete the pending one so the envelope isn't double-hit.
async function mergeReceiptMatches(supabaseAdmin, added) {
  if (!added.length) return;
  const { data: pending } = await supabaseAdmin
    .from('budget_transactions')
    .select('id, date, amount, category_id, note, receipt_path, excluded')
    .eq('source', 'receipt');
  if (!pending || pending.length === 0) return;

  const used = new Set();
  for (const txn of added) {
    const amt = Number(txn.amount);
    let best = null;
    let bestScore = Infinity;
    for (const r of pending) {
      if (used.has(r.id)) continue;
      const da = Math.abs(Number(r.amount) - amt);
      if (da > 0.75) continue; // totals should match (small tolerance for tips/rounding)
      const dd = daysApart(r.date, txn.date);
      if (dd > 4) continue;
      const score = da * 10 + dd;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) continue;
    used.add(best.id);

    const { data: plaidRow } = await supabaseAdmin
      .from('budget_transactions')
      .select('id, category_id')
      .eq('plaid_transaction_id', txn.transaction_id)
      .maybeSingle();
    if (!plaidRow) continue;

    const update = {};
    if (best.note) update.note = best.note;
    if (best.receipt_path) update.receipt_path = best.receipt_path;
    if (best.excluded) {
      // The receipt was split across envelopes at scan time: its child rows
      // already carry the real amounts and categories. Exclude the posted bank
      // charge so the same money isn't counted twice, and leave the children be.
      update.excluded = true;
    } else if ((plaidRow.category_id === 'needs-review' || !plaidRow.category_id) && best.category_id && best.category_id !== 'needs-review') {
      update.category_id = best.category_id;
    }
    if (Object.keys(update).length > 0) {
      await supabaseAdmin.from('budget_transactions').update(update).eq('id', plaidRow.id);
    }
    await supabaseAdmin.from('budget_transactions').delete().eq('id', best.id);
  }
}

async function syncBalance(supabaseAdmin, plaid, item) {
  const { data } = await plaid.accountsBalanceGet({ access_token: item.access_token });
  const accounts = data.accounts || [];
  const list = accounts.map((a) => ({
    id: budgetAccountId(a.account_id),
    name: `${item.institution_name || 'Bank'} · ${a.name || a.official_name || a.subtype || 'Account'}${a.mask ? ` ••${a.mask}` : ''}`,
    type: mapAccountType(a),
    balance: accountBalance(a),
  }));
  await upsertPlaidAccounts(supabaseAdmin, list);
  // Record a short per-account label on the item's status so the Accounts page
  // can tell two same-named banks (e.g. two Chase logins) apart.
  try {
    await setPlaidStatus(supabaseAdmin, item.id, {
      accounts: accounts.map((a) => ({
        label: a.name || a.official_name || a.subtype || 'Account',
        mask: a.mask || null,
      })),
    });
  } catch (err) {
    console.error('Failed to record account labels:', err?.message || err);
  }
}

// After the normal import, chase email receipts for the transactions that
// landed in Needs Review, so they get filled in without a button press.
async function autoLookupReceipts(supabaseAdmin, needsReviewPlaidIds, categories) {
  if (needsReviewPlaidIds.length === 0 || !process.env.ANTHROPIC_API_KEY) return;
  const { count } = await supabaseAdmin.from('gmail_accounts').select('id', { count: 'exact', head: true });
  if (!count) return; // no inboxes connected

  const ids = needsReviewPlaidIds.slice(0, MAX_RECEIPT_LOOKUPS);
  const { data: rows } = await supabaseAdmin
    .from('budget_transactions')
    .select('id, date, description, amount')
    .in('plaid_transaction_id', ids);

  for (const t of rows || []) {
    try {
      const r = await lookupReceiptForTx(supabaseAdmin, t, categories);
      if (!r.found) continue;
      const update = {};
      if (r.detail) update.note = String(r.detail).slice(0, 500);
      if (r.categoryId && categories.some((c) => c.id === r.categoryId)) update.category_id = r.categoryId;
      if (r.business) update.business = true;
      if (Object.keys(update).length > 0) {
        await supabaseAdmin.from('budget_transactions').update(update).eq('id', t.id);
      }
    } catch (err) {
      console.error('auto receipt lookup failed:', err?.message || err);
    }
  }
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

    const budget = await loadBudget(supabaseAdmin);
    // Clean slate: don't import history from before the ledger starts. Plaid's
    // sync has no date filter, so we drop older transactions here (the cursor
    // still advances past them, they're just never written).
    const cutoff = importCutoff(budget);
    const withinCutoff = (t) => !cutoff || t.date >= cutoff;
    const addedNew = added.filter(withinCutoff);
    const changed = [...added, ...modified].filter(withinCutoff);
    const categories = (budget.categories || []).filter((c) => c.id !== 'needs-review');
    const { assignments, businessSet } = await assignCategories(supabaseAdmin, changed, categories);

    const needsReviewPlaidIds = [];
    for (const txn of changed) {
      // A transfer or card payoff isn't spending: leave it uncategorized and
      // Ignored so it never hits an envelope or the Needs Review queue.
      const isXfer = isTransferOrCardPayment(txn);
      const categoryId = isXfer ? null : assignments[txn.transaction_id] || 'needs-review';
      if (!isXfer && categoryId === 'needs-review') needsReviewPlaidIds.push(txn.transaction_id);
      const row = {
        plaid_transaction_id: txn.transaction_id,
        date: txn.date,
        description: txn.merchant_name || txn.name,
        amount: txn.amount, // Plaid: positive = money out, matches this app's convention
        category_id: categoryId,
        // Route each transaction to its own account (a bank can have several).
        account_id: txn.account_id ? budgetAccountId(txn.account_id) : item.account_id,
        source: 'plaid',
      };
      // Only set business when detected — never write false, so a re-sync of a
      // modified transaction can't clear a flag the user set by hand.
      if (businessSet.has(txn.transaction_id)) row.business = true;
      if (isXfer) row.excluded = true;
      const { error } = await supabaseAdmin
        .from('budget_transactions')
        .upsert(row, { onConflict: 'plaid_transaction_id' });
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
      await mergeReceiptMatches(supabaseAdmin, addedNew);
    } catch (err) {
      console.error('Receipt match phase failed:', err?.message || err);
    }

    try {
      await syncBalance(supabaseAdmin, plaid, item);
    } catch (err) {
      console.error('Failed to sync balance:', err?.response?.data ?? err?.message ?? err);
    }

    try {
      await autoLookupReceipts(supabaseAdmin, needsReviewPlaidIds, categories);
    } catch (err) {
      console.error('Auto receipt lookup phase failed:', err?.message || err);
    }

    // Clear any prior sync error now that this bank synced cleanly.
    await setPlaidStatus(supabaseAdmin, itemRowId, {
      linked: true,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      lastErrorCode: null,
    });

    return { synced: changed.length, removed: removed.length };
  } finally {
    await supabaseAdmin.from('plaid_items').update({ syncing: false }).eq('id', itemRowId);
  }
}
