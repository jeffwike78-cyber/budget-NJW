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
    reload();
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

  async function recategorize(id, categoryId) {
    try {
      const { error } = await supabase.from('budget_transactions').update({ category_id: categoryId }).eq('id', id);
      if (error) console.error('Failed to recategorize transaction:', error);
    } catch (err) {
      console.error('Failed to recategorize transaction:', err);
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

  return { transactions, loading, addTransaction, recategorize, setExcluded, setBusiness, setTaxCategory };
}
