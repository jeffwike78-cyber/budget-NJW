import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

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

  async function addTransaction({ date, description, amount, categoryId, accountId }) {
    try {
      const { error } = await supabase.from('budget_transactions').insert({
        date,
        description,
        amount,
        category_id: categoryId,
        account_id: accountId,
        source: 'manual',
      });
      if (error) console.error('Failed to add transaction:', error);
    } catch (err) {
      console.error('Failed to add transaction:', err);
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
