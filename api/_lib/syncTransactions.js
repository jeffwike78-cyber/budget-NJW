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

function accountLabels(accounts) {
  return (accounts || []).map((a) => ({
    label: a.name || a.official_name || a.subtype || 'Account',
    mask: a.mask || null,
  }));
}

// Record a short per-account label (name + last-4) on the item's status so the
// Accounts page can tell two same-named banks (e.g. two Chase logins) apart —
// and, critically, so a connection that can't sync transactions can still be
// identified before the user reconnects it. Uses accountsGet, which lists the
// item's accounts independently of the (possibly failing) transactions product.
async function recordAccountLabels(supabaseAdmin, plaid, item) {
  try {
    const { data } = await plaid.accountsGet({ access_token: item.access_token });
    const labels = accountLabels(data.accounts);
    if (labels.length > 0) {
      await setPlaidStatus(supabaseAdmin, item.id, { accounts: labels });
    }
  } catch (err) {
    console.error('Failed to record account labels:', err?.response?.data ?? err?.message ?? err);
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
    plaidItemId: item.id,
  }));
  await upsertPlaidAccounts(supabaseAdmin, list);
  try {
    await setPlaidStatus(supabaseAdmin, item.id, { accounts: accountLabels(accounts) });
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

// The budget account ids that belong to one Plaid item. Accounts are tagged
// with plaidItemId when synced; fall back to the item's legacy combined account
// id for connections linked before that tagging existed.
function itemAccountIds(budget, item) {
  const ids = (budget.accounts || []).filter((a) => a.plaidItemId === item.id).map((a) => a.id);
  if (ids.length === 0 && item.account_id) ids.push(item.account_id);
  return ids;
}

// The same import scope the sync applies: skip pre-cutoff history and
// balance-only accounts.
function buildScope(budget, item) {
  const cutoff = importCutoff(budget);
  const withinCutoff = (t) => !cutoff || t.date >= cutoff;
  const balanceOnlyIds = new Set((budget.accounts || []).filter((a) => a.balanceOnly).map((a) => a.id));
  const inScope = (t) => !balanceOnlyIds.has(t.account_id ? budgetAccountId(t.account_id) : item.account_id);
  return { withinCutoff, inScope };
}

// Pull an item's COMPLETE current transaction set from Plaid (a fresh null-cursor
// walk) without disturbing the stored incremental cursor. Returns the ids Plaid
// still recognizes, the ids of pending charges it has since replaced (via
// pending_transaction_id — these are duplicates the bank no longer shows), and
// the earliest date it covered.
async function collectCurrentTxIds(plaid, item, withinCutoff, inScope) {
  const seenIds = new Set();
  const supersededIds = new Set();
  const pendingTxns = []; // {id, key, date}
  const postedTxns = []; // {key, date}
  let minDate = null;
  let cursor = null;
  let hasMore = true;
  let guard = 0;
  const keyOf = (t) =>
    `${t.account_id}|${Number(t.amount).toFixed(2)}|${String(t.merchant_name || t.name || '').trim().toLowerCase()}`;
  while (hasMore && guard++ < 100) {
    const resp = await plaid.transactionsSync({ access_token: item.access_token, cursor: cursor || undefined });
    for (const t of [...resp.data.added, ...resp.data.modified]) {
      if (!withinCutoff(t) || !inScope(t)) continue;
      seenIds.add(t.transaction_id);
      if (t.pending_transaction_id) supersededIds.add(t.pending_transaction_id); // Plaid's explicit link
      if (t.pending) pendingTxns.push({ id: t.transaction_id, key: keyOf(t), date: t.date });
      else postedTxns.push({ key: keyOf(t), date: t.date });
      if (!minDate || t.date < minDate) minDate = t.date;
    }
    hasMore = resp.data.has_more;
    cursor = resp.data.next_cursor;
  }

  // Backstop for institutions that don't populate pending_transaction_id: a
  // still-pending charge that has a matching POSTED charge (same account, amount,
  // and merchant within a few days) is the same purchase — the pending copy is a
  // duplicate. Date-bounded so a recurring identical charge in a later month
  // isn't wrongly matched to an earlier month's posting.
  const heuristicSupersededIds = new Set();
  for (const p of pendingTxns) {
    if (supersededIds.has(p.id)) continue;
    const match = postedTxns.some((q) => q.key === p.key && Math.abs(daysApart(p.date, q.date)) <= 5);
    if (match) heuristicSupersededIds.add(p.id);
  }

  return { seenIds, supersededIds, heuristicSupersededIds, minDate };
}

// Delete specific plaid rows by their Plaid transaction ids, scoped to the given
// accounts. Returns how many rows were removed. Used to clear superseded pending
// charges. Never touches non-plaid rows (the id filter already limits to them).
async function deleteByPlaidIds(supabaseAdmin, accountIds, plaidIds) {
  if (!accountIds.length || !plaidIds.length) return 0;
  let removed = 0;
  for (let i = 0; i < plaidIds.length; i += 100) {
    const chunk = plaidIds.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from('budget_transactions')
      .delete()
      .in('account_id', accountIds)
      .in('plaid_transaction_id', chunk)
      .select('id');
    if (error) console.error('Failed to delete superseded transactions:', error);
    else removed += (data || []).length;
  }
  return removed;
}

// Delete stored plaid rows Plaid no longer knows about (orphans). Scoped to the
// given accounts and to date >= minDate (the range Plaid actually covered), so
// history older than Plaid's window and other banks' rows are never touched.
// With dryRun it reports what it WOULD remove without deleting. Never touches
// manual / receipt / split rows.
async function deleteOrphans(supabaseAdmin, accountIds, seenIds, minDate, { dryRun = false, supersededIds } = {}) {
  if (!accountIds.length || seenIds.size === 0 || !minDate) return [];
  const superseded = supersededIds || new Set();
  const { data: rows } = await supabaseAdmin
    .from('budget_transactions')
    .select('id, plaid_transaction_id, date, description, amount, account_id')
    .eq('source', 'plaid')
    .in('account_id', accountIds)
    .gte('date', minDate);
  // A row is removable if the bank no longer lists it at all (orphan) OR Plaid
  // has replaced it with a posted charge (superseded pending). Both are dupes
  // the bank no longer shows.
  const orphans = (rows || []).filter(
    (r) => r.plaid_transaction_id && (!seenIds.has(r.plaid_transaction_id) || superseded.has(r.plaid_transaction_id))
  );
  if (!dryRun && orphans.length > 0) {
    const ids = orphans.map((o) => o.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabaseAdmin.from('budget_transactions').delete().in('id', ids.slice(i, i + 100));
      if (error) console.error('Failed to delete orphan transactions:', error);
    }
  }
  return orphans.map((o) => ({ id: o.id, date: o.date, description: o.description, amount: Number(o.amount), accountId: o.account_id }));
}

// Audit one bank against Plaid's live feed (which mirrors what the bank shows)
// and remove imported rows the bank no longer has — the duplicate phantoms left
// by past pending→posted transitions. dryRun returns the list without deleting.
export async function reconcileItem(supabaseAdmin, plaid, itemRowId, { dryRun = false } = {}) {
  const { data: item } = await supabaseAdmin.from('plaid_items').select('*').eq('id', itemRowId).maybeSingle();
  if (!item) return { removed: [], seen: 0, reason: 'no-item' };
  const budget = await loadBudget(supabaseAdmin);
  const { withinCutoff, inScope } = buildScope(budget, item);
  const { seenIds, supersededIds, heuristicSupersededIds, minDate } = await collectCurrentTxIds(plaid, item, withinCutoff, inScope);
  // The manual audit is preview-first (the user confirms before anything is
  // deleted), so it also applies the same-purchase heuristic; the automatic
  // sync sweep stays limited to Plaid's explicit link.
  const allSuperseded = new Set([...supersededIds, ...heuristicSupersededIds]);
  const removed = await deleteOrphans(supabaseAdmin, itemAccountIds(budget, item), seenIds, minDate, {
    dryRun,
    supersededIds: allSuperseded,
  });
  return { removed, seen: seenIds.size };
}

// Direct database catch-all: find imported rows that are exact duplicates of
// each other — same date, amount, and merchant — and keep only one per group.
// This catches duplicates however they arose (a lost pending→posted removal, an
// institution that doesn't link the two, or the same account synced twice),
// independent of what Plaid currently reports. Deterministic keeper: the NEWEST
// imported row (or, tie, the largest id) — when a pending charge and its posted
// copy both linger, the posted one was imported later, so keeping the newest
// keeps the canonical charge and drops the pending (never the reverse, which
// could delete the charge that survives). Returns the rows to remove; with
// dryRun it only lists them. `excludeIds` skips rows another pass already
// removed. Also flags when a group spans more than one account (the sign of a
// duplicate bank connection, which the user should disconnect to stop it
// recurring).
export async function findDbDuplicates(supabaseAdmin, { dryRun = false, excludeIds = new Set() } = {}) {
  const { data: rows } = await supabaseAdmin
    .from('budget_transactions')
    .select('id, account_id, plaid_transaction_id, date, amount, description, created_at')
    .eq('source', 'plaid');
  const groups = new Map();
  for (const r of rows || []) {
    if (excludeIds.has(r.id)) continue;
    const key = `${r.date}|${Number(r.amount).toFixed(2)}|${String(r.description || '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const removable = [];
  let multiAccount = false;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    if (new Set(list.map((r) => r.account_id)).size > 1) multiAccount = true;
    // Keep the newest (last imported = the posted copy); remove the rest.
    list.sort((a, b) => {
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      if (ta !== tb) return ta > tb ? -1 : 1;
      return String(a.id) > String(b.id) ? -1 : 1;
    });
    for (const r of list.slice(1)) {
      removable.push({ id: r.id, date: r.date, description: r.description, amount: Number(r.amount), accountId: r.account_id });
    }
  }

  if (!dryRun && removable.length > 0) {
    const ids = removable.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabaseAdmin.from('budget_transactions').delete().in('id', ids.slice(i, i + 100));
      if (error) console.error('Failed to delete duplicate transactions:', error);
    }
  }
  return { removable, multiAccount };
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

  // Soft time budget: the serverless function is capped at 60s. The account and
  // transaction writes below are what matter and finish first; the optional
  // Gmail receipt lookups at the end can be slow (and are currently slow to fail
  // when a Gmail token is expired), so we skip them once we're near the limit
  // rather than let them push the whole request into a 504.
  const startedAt = Date.now();
  const RECEIPT_LOOKUP_DEADLINE_MS = 40000;

  try {
    // Populate this bank's accounts FIRST, before the (slow) transaction pull.
    // Account list + balances don't depend on transactions, so doing this up
    // front means the accounts land in the budget even if the transaction sync
    // later fails, or the serverless function hits its time limit partway
    // through. This is what makes a reconnected card/account show up reliably.
    // It only adds/updates accounts — it never removes any.
    try {
      await syncBalance(supabaseAdmin, plaid, item);
    } catch (err) {
      console.error('Failed to sync balance:', err?.response?.data ?? err?.message ?? err);
    }

    const budget = await loadBudget(supabaseAdmin);
    // Clean slate: don't import history from before the ledger starts. Plaid's
    // sync has no date filter, so we drop older transactions here (the cursor
    // still advances past them, they're just never written).
    const cutoff = importCutoff(budget);
    const withinCutoff = (t) => !cutoff || t.date >= cutoff;
    const categories = (budget.categories || []).filter((c) => c.id !== 'needs-review');

    // Accounts the user flagged "balance only" (e.g. savings): keep refreshing
    // their balance (done in syncBalance above) but don't import their
    // transactions. Drop any that were imported before the flag was set.
    const balanceOnlyIds = new Set((budget.accounts || []).filter((a) => a.balanceOnly).map((a) => a.id));
    const inScope = (t) => !balanceOnlyIds.has(t.account_id ? budgetAccountId(t.account_id) : item.account_id);
    if (balanceOnlyIds.size > 0) {
      await supabaseAdmin.from('budget_transactions').delete().eq('source', 'plaid').in('account_id', [...balanceOnlyIds]);
    }

    let cursor = item.sync_cursor;
    // A sync that starts from a null cursor is a full refresh: Plaid returns the
    // account's complete current set, so once it finishes we can reconcile — any
    // stored plaid row Plaid didn't mention is an orphan (a pending charge that
    // posted under a new id after an earlier cursor reset, whose 'removed' event
    // we never got). Track everything Plaid returns so we can sweep those.
    const startedFromNull = !item.sync_cursor;
    const seenIds = new Set();
    // When a pending charge posts, Plaid gives the posted transaction a NEW id
    // and points its `pending_transaction_id` back at the pending one it
    // replaced. That pending row in our DB is now a duplicate the bank no longer
    // shows. Collecting these lets us delete them even when Plaid still lists the
    // pending in the feed and our earlier `removed` event was lost to a cursor
    // reset — the exact cause of the visible "Yummy Bowl / Casa Brava" dupes.
    const supersededIds = new Set();
    let minSeenDate = null;
    const addedNew = [];
    const needsReviewPlaidIds = [];
    let syncedCount = 0;
    let removedCount = 0;

    // Turn a Plaid transaction into a DB row. `forInsert` controls the boolean
    // flags: a brand-new row always carries them so a batched upsert has uniform
    // columns (Postgres rejects a mixed batch — some rows with the column, some
    // without — by writing NULL into the NOT-NULL `business`/`excluded`
    // columns). A MODIFIED row omits a false flag instead, so a re-sync can't
    // clear a `business`/`excluded` flag the user set by hand.
    const buildRow = (txn, assignments, businessSet, forInsert) => {
      // A transfer or card payoff isn't spending: leave it uncategorized and
      // Ignored so it never hits an envelope or the Needs Review queue.
      const isXfer = isTransferOrCardPayment(txn);
      const categoryId = isXfer ? null : assignments[txn.transaction_id] || 'needs-review';
      if (!isXfer && categoryId === 'needs-review') needsReviewPlaidIds.push(txn.transaction_id);
      const business = businessSet.has(txn.transaction_id);
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
      if (forInsert || business) row.business = business;
      if (forInsert || isXfer) row.excluded = isXfer;
      return row;
    };

    // Process each page as it arrives and save the cursor right after, so
    // partial progress is durable: if the function later times out, the next
    // sync resumes from here instead of re-pulling the whole history (which was
    // causing repeated 60s timeouts and a "last synced" that never advanced).
    let hasMore = true;
    while (hasMore) {
      let resp;
      try {
        resp = await plaid.transactionsSync({ access_token: item.access_token, cursor: cursor || undefined });
      } catch (txErr) {
        // Plaid reports the underlying data changed mid-pagination (common while
        // a freshly linked account is still backfilling). Saving the cursor per
        // page can leave it wedged at a mid-point that Plaid then keeps
        // rejecting, so restart pagination cleanly from the beginning (null
        // cursor) — Plaid's own recommended recovery. The next sync (or Plaid's
        // webhook) re-pulls from scratch; every row is upserted by
        // plaid_transaction_id, so re-fetching is idempotent — nothing is lost
        // or double-counted. A tight in-loop retry doesn't help while the data
        // is still settling and just burns the function's time budget.
        if (txErr?.response?.data?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') {
          await supabaseAdmin.from('plaid_items').update({ sync_cursor: null }).eq('id', itemRowId);
          throw txErr;
        }
        // Other transaction failures (e.g. a stale login → NO_ACCOUNTS): the
        // account list is usually still readable, so record it (the accounts are
        // already populated above) then let the failure flag the item.
        await recordAccountLabels(supabaseAdmin, plaid, item);
        throw txErr;
      }

      const pageAdded = resp.data.added.filter(withinCutoff).filter(inScope);
      const pageModified = resp.data.modified.filter(withinCutoff).filter(inScope);
      for (const t of [...pageAdded, ...pageModified]) {
        seenIds.add(t.transaction_id);
        if (t.pending_transaction_id) supersededIds.add(t.pending_transaction_id);
        if (!minSeenDate || t.date < minSeenDate) minSeenDate = t.date;
      }
      const { assignments, businessSet } = await assignCategories(supabaseAdmin, [...pageAdded, ...pageModified], categories);

      // New rows share the same columns → one batched upsert per page.
      const insertRows = pageAdded.map((t) => buildRow(t, assignments, businessSet, true));
      if (insertRows.length > 0) {
        const { error } = await supabaseAdmin
          .from('budget_transactions')
          .upsert(insertRows, { onConflict: 'plaid_transaction_id' });
        if (error) console.error('Failed to upsert transactions:', error);
      }

      // Modified rows upsert individually so an omitted false flag can't clear a
      // flag the user set on the existing row.
      for (const t of pageModified) {
        const { error } = await supabaseAdmin
          .from('budget_transactions')
          .upsert(buildRow(t, assignments, businessSet, false), { onConflict: 'plaid_transaction_id' });
        if (error) console.error('Failed to upsert transaction:', error);
      }

      const removeIds = resp.data.removed.map((t) => t.transaction_id);
      if (removeIds.length > 0) {
        const { error } = await supabaseAdmin
          .from('budget_transactions')
          .delete()
          .in('plaid_transaction_id', removeIds);
        if (error) console.error('Failed to delete removed transactions:', error);
      }

      hasMore = resp.data.has_more;
      cursor = resp.data.next_cursor;
      await supabaseAdmin.from('plaid_items').update({ sync_cursor: cursor }).eq('id', itemRowId);

      addedNew.push(...pageAdded);
      syncedCount += pageAdded.length + pageModified.length;
      removedCount += removeIds.length;
    }

    // Sweep superseded pending rows (a pending charge that has since posted under
    // a new id — Plaid told us via pending_transaction_id). Runs every sync, so
    // these duplicates clear even without a full refresh.
    const acctIds = itemAccountIds(budget, item);
    if (supersededIds.size > 0 && acctIds.length > 0) {
      try {
        const swept = await deleteByPlaidIds(supabaseAdmin, acctIds, [...supersededIds]);
        if (swept > 0) {
          removedCount += swept;
          console.log(`Removed ${swept} superseded pending transaction(s) for item ${itemRowId}.`);
        }
      } catch (err) {
        console.error('Superseded-pending sweep failed:', err?.message || err);
      }
    }

    // Self-heal: a full refresh (started from a null cursor and ran to the end)
    // gives Plaid's complete current set for this bank, so also sweep any
    // orphaned plaid rows it didn't mention at all — phantoms left by a past
    // cursor reset. Scoped to this bank's accounts and to the date range Plaid
    // actually covered, so older history and other banks are never touched.
    if (startedFromNull && seenIds.size > 0) {
      try {
        const swept = await deleteOrphans(supabaseAdmin, acctIds, seenIds, minSeenDate);
        if (swept.length > 0) {
          removedCount += swept.length;
          console.log(`Reconcile removed ${swept.length} orphaned transaction(s) for item ${itemRowId}.`);
        }
      } catch (err) {
        console.error('Orphan reconcile phase failed:', err?.message || err);
      }
    }

    try {
      await mergeReceiptMatches(supabaseAdmin, addedNew);
    } catch (err) {
      console.error('Receipt match phase failed:', err?.message || err);
    }

    if (Date.now() - startedAt < RECEIPT_LOOKUP_DEADLINE_MS) {
      try {
        await autoLookupReceipts(supabaseAdmin, needsReviewPlaidIds, categories);
      } catch (err) {
        console.error('Auto receipt lookup phase failed:', err?.message || err);
      }
    } else {
      console.warn('Skipping receipt lookups: near function time limit');
    }

    // Clear any prior sync error now that this bank synced cleanly.
    await setPlaidStatus(supabaseAdmin, itemRowId, {
      linked: true,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      lastErrorCode: null,
    });

    return { synced: syncedCount, removed: removedCount };
  } finally {
    await supabaseAdmin.from('plaid_items').update({ syncing: false }).eq('id', itemRowId);
  }
}
