import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

// Flatten whatever Supabase / the browser hands back into one readable line, so
// the exact failure shows on screen without needing the dev console. Postgres/RLS
// errors carry {message, code, details, hint}; a network/fetch failure is a bare
// Error/TypeError with just a name + message.
function describeError(e) {
  if (!e) return 'Unknown error (no details).';
  if (typeof e === 'string') return e;
  const parts = [];
  if (e.name && e.name !== 'Error') parts.push(e.name);
  if (e.message) parts.push(e.message);
  if (e.code) parts.push(`code ${e.code}`);
  if (e.details) parts.push(String(e.details));
  if (e.hint) parts.push(`hint: ${e.hint}`);
  const s = parts.filter(Boolean).join(' · ');
  const base = s || JSON.stringify(e);
  // A fetch that never reaches the server is a bare TypeError with no Postgres
  // code — almost always a bad Supabase URL/key in the deploy's env vars
  // (a typo, or a trailing space/newline from pasting). Say so plainly.
  const looksNetwork =
    !e.code &&
    (e.name === 'TypeError' ||
      /failed to fetch|load failed|type error|networkerror/i.test(e.message || ''));
  if (looksNetwork) {
    return `${base} — the app can’t reach the database. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel (no trailing spaces or line breaks), then redeploy.`;
  }
  return base;
}

function rowToTx(row) {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amount: Number(row.amount),
    categoryId: row.category_id,
    accountId: row.account_id,
    source: row.source,
    excluded: row.excluded,
    note: row.note,
    business: row.business,
    taxCategory: row.tax_category,
    receiptPath: row.receipt_path,
    userReviewed: !!row.user_reviewed,
  };
}

// Transactions live in their own table (not the app_state jsonb blob) so the
// Plaid sync can upsert/delete individual rows. Subscribes to realtime
// changes so a webhook-triggered sync shows up here without a manual refresh.
export function useBudgetTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Unique per mount so React's dev-mode double-invoke (or a real remount)
  // never tries to re-subscribe a channel name Supabase already has open.
  const channelNameRef = useRef(`budget_transactions_changes_${crypto.randomUUID()}`);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('budget_transactions')
        .select('*')
        .order('date', { ascending: false });
      if (error) console.error('Failed to load transactions:', error);
      setTransactions((data || []).map(rowToTx));
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Transactions are behind RLS scoped to signed-in users — only load once
    // there's a session, and reload on sign-in. onAuthStateChange fires with the
    // restored session on start and again on login.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) reload();
      else setLoading(false);
    });
    let channel;
    try {
      channel = supabase
        .channel(channelNameRef.current)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_transactions' }, () => {
          reload();
        })
        .subscribe();
    } catch (err) {
      console.error('Failed to subscribe to transaction changes:', err);
    }
    return () => {
      sub?.subscription?.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [reload]);

  async function addTransaction({ date, description, amount, categoryId, accountId, source = 'manual', note, receiptPath }) {
    try {
      const row = {
        date,
        description,
        amount,
        category_id: categoryId,
        account_id: accountId,
        source,
      };
      if (note) row.note = note;
      if (receiptPath) row.receipt_path = receiptPath;
      // .select() returns the inserted row — but only if a read (RLS SELECT)
      // policy allows it. So this distinguishes: insert blocked (error), insert
      // ok + readable (data has the row), insert ok + NOT readable (empty, no
      // error — a missing SELECT policy).
      // Insert WITHOUT a follow-up select first. A .select() after insert asks
      // PostgREST for the row back (return=representation) and adds a read
      // requirement; isolating the plain insert tells us whether the *write*
      // itself is what fails.
      const { error } = await supabase.from('budget_transactions').insert(row);
      if (error) {
        console.error('Failed to add transaction (insert error):', describeError(error), error);
        return { message: describeError(error) };
      }
      await reload(); // don't rely on realtime alone — refresh the list now
      return null;
    } catch (err) {
      console.error('Failed to add transaction (threw):', describeError(err), err);
      return { message: describeError(err) };
    }
  }

  // Split one transaction across several envelopes: insert a child row per part
  // (they sum to the original and each carry their own category), then mark the
  // original Ignored so nothing double-counts. The receipt/photo rides along on
  // the first child so it stays viewable on a counted row.
  async function splitTransaction(parent, parts) {
    try {
      const rows = parts.map((p) => {
        const row = {
          date: parent.date,
          description: parent.description,
          amount: Number(p.amount),
          category_id: p.categoryId || null,
          account_id: parent.accountId,
          source: 'split',
        };
        if (p.note) row.note = p.note;
        return row;
      });
      if (parent.receiptPath && rows[0]) rows[0].receipt_path = parent.receiptPath;
      const { error: insErr } = await supabase.from('budget_transactions').insert(rows);
      if (insErr) return { message: describeError(insErr) };
      const { error: exErr } = await supabase
        .from('budget_transactions')
        .update({ excluded: true })
        .eq('id', parent.id);
      if (exErr) return { message: describeError(exErr) };
      await reload();
      return null;
    } catch (err) {
      return { message: describeError(err) };
    }
  }

  // Find an existing, still-counted bank (Plaid) transaction that looks like the
  // same purchase as a receipt total — same amount (small tolerance) within a
  // week — so a receipt uploaded AFTER the charge already posted can merge with
  // it instead of adding a duplicate row.
  async function findMatchingBankCharge(total, dateStr, { tol = 0.75, withinDays = 7 } = {}) {
    const target = Math.abs(Number(total));
    if (!(target > 0)) return null;
    const { data, error } = await supabase
      .from('budget_transactions')
      .select('id, amount, date')
      .eq('source', 'plaid')
      .eq('excluded', false);
    if (error || !data) return null;
    let best = null;
    let bestScore = Infinity;
    for (const r of data) {
      const da = Math.abs(Math.abs(Number(r.amount)) - target);
      if (da > tol) continue;
      const dd = Math.abs((new Date(`${r.date}T00:00:00`) - new Date(`${dateStr}T00:00:00`)) / 86400000);
      if (dd > withinDays) continue;
      const score = da * 10 + dd;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  // Add a transaction that's split across several envelopes in one step (used by
  // the receipt-scan / add form). Each part becomes its own counted row sharing
  // the vendor/date/account. For a scanned receipt: if the bank already imported
  // the charge, exclude that bank row so it doesn't double-count with the split;
  // otherwise drop a single full-total, excluded "anchor" row (source='receipt')
  // so the charge reconciles when it posts — see mergeReceiptMatches in
  // syncTransactions.
  async function addSplitTransaction(base, parts) {
    try {
      const isReceipt = !!base.receiptPath;
      const total = parts.reduce((s, p) => s + Number(p.amount), 0);
      if (isReceipt) {
        // Bank charge already here (split-uploaded after the sync)? Hide it.
        const match = await findMatchingBankCharge(total, base.date);
        if (match) {
          const { error: exErr } = await supabase.from('budget_transactions').update({ excluded: true }).eq('id', match.id);
          if (exErr) return { message: describeError(exErr) };
        } else {
          // No charge yet — leave an anchor for the sync to reconcile against.
          const anchor = {
            date: base.date,
            description: base.description,
            amount: total,
            category_id: null,
            account_id: base.accountId,
            source: 'receipt',
            excluded: true,
            receipt_path: base.receiptPath,
          };
          if (base.note) anchor.note = base.note;
          const { error: anchorErr } = await supabase.from('budget_transactions').insert(anchor);
          if (anchorErr) return { message: describeError(anchorErr) };
        }
      }
      const rows = parts.map((p, i) => {
        const row = {
          date: base.date,
          description: base.description,
          amount: Number(p.amount),
          category_id: p.categoryId || null,
          account_id: base.accountId,
          source: 'split',
        };
        if (base.note) row.note = base.note;
        // Keep the photo viewable on a counted row (the anchor is hidden).
        if (isReceipt && i === 0) row.receipt_path = base.receiptPath;
        return row;
      });
      const { error: insErr } = await supabase.from('budget_transactions').insert(rows);
      if (insErr) return { message: describeError(insErr) };
      await reload();
      return null;
    } catch (err) {
      return { message: describeError(err) };
    }
  }

  async function deleteTransaction(id) {
    try {
      const { error } = await supabase.from('budget_transactions').delete().eq('id', id);
      if (error) return { message: describeError(error) };
      await reload();
      return null;
    } catch (err) {
      return { message: describeError(err) };
    }
  }

  // Recategorize a transaction. By default this is a USER action, so it marks
  // the row user_reviewed=true (moving it to "User Reviewed" and out of "AI
  // Reviewed"). The AI auto-categorize path passes { userReviewed: false } so
  // its picks stay in "AI Reviewed" until a human confirms/corrects them.
  async function recategorize(id, categoryId, { userReviewed = true } = {}) {
    try {
      const { error } = await supabase
        .from('budget_transactions')
        .update({ category_id: categoryId, user_reviewed: userReviewed })
        .eq('id', id);
      if (error) {
        // 42703 = column doesn't exist yet (the user_reviewed migration hasn't
        // been run). Fall back to just the category so recategorizing still works.
        if (error.code === '42703') {
          const { error: e2 } = await supabase.from('budget_transactions').update({ category_id: categoryId }).eq('id', id);
          if (e2) console.error('Failed to recategorize transaction:', e2);
        } else {
          console.error('Failed to recategorize transaction:', error);
        }
      }
    } catch (err) {
      console.error('Failed to recategorize transaction:', err);
    }
  }

  // Confirm the AI got it right: mark the row user_reviewed=true WITHOUT changing
  // its category, so it leaves "AI Reviewed" and lands in "User Reviewed". If the
  // migration column isn't there yet (42703) this is a harmless no-op.
  async function confirmReviewed(id) {
    try {
      const { error } = await supabase.from('budget_transactions').update({ user_reviewed: true }).eq('id', id);
      if (error && error.code !== '42703') console.error('Failed to confirm transaction:', error);
    } catch (err) {
      console.error('Failed to confirm transaction:', err);
    }
  }

  // Send a transaction back to "Needs Review" (e.g. a charge from a spouse or a
  // generic label the user isn't sure how to classify).
  async function setNeedsReview(id) {
    try {
      const { error } = await supabase.from('budget_transactions').update({ category_id: 'needs-review' }).eq('id', id);
      if (error) console.error('Failed to send transaction to Needs Review:', error);
    } catch (err) {
      console.error('Failed to send transaction to Needs Review:', err);
    }
  }

  async function setExcluded(id, excluded) {
    try {
      const { error } = await supabase.from('budget_transactions').update({ excluded }).eq('id', id);
      if (error) console.error('Failed to update excluded flag:', error);
    } catch (err) {
      console.error('Failed to update excluded flag:', err);
    }
  }

  async function setFlag(id, field, value) {
    try {
      const { error } = await supabase.from('budget_transactions').update({ [field]: value }).eq('id', id);
      if (error) console.error(`Failed to update ${field} flag:`, error);
    } catch (err) {
      console.error(`Failed to update ${field} flag:`, err);
    }
  }

  const setBusiness = (id, value) => setFlag(id, 'business', value);
  const setTaxCategory = (id, value) => setFlag(id, 'tax_category', value || null);

  return { transactions, loading, addTransaction, addSplitTransaction, splitTransaction, deleteTransaction, recategorize, confirmReviewed, setNeedsReview, setExcluded, setBusiness, setTaxCategory };
}
