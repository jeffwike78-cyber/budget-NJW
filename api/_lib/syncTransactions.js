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

    let cursor = item.sync_cursor;
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
    let mutationRetries = 0;
    while (hasMore) {
      let resp;
      try {
        resp = await plaid.transactionsSync({ access_token: item.access_token, cursor: cursor || undefined });
      } catch (txErr) {
        // Plaid can report that the underlying data changed mid-pagination
        // (common while a freshly linked account is still backfilling). Its
        // guidance is to restart from the last persisted cursor — which we have,
        // since we save it after every page — so just retry rather than failing.
        if (txErr?.response?.data?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && mutationRetries < 5) {
          mutationRetries += 1;
          continue;
        }
        // Other transaction failures (e.g. a stale login → NO_ACCOUNTS): the
        // account list is usually still readable, so record it (the accounts are
        // already populated above) then let the failure flag the item.
        await recordAccountLabels(supabaseAdmin, plaid, item);
        throw txErr;
      }

      const pageAdded = resp.data.added.filter(withinCutoff);
      const pageModified = resp.data.modified.filter(withinCutoff);
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
