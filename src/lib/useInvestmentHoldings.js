import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

function rowToHolding(row) {
  return {
    id: row.id,
    securityName: row.security_name,
    ticker: row.ticker,
    quantity: row.quantity == null ? null : Number(row.quantity),
    value: Number(row.value),
  };
}

// Holdings are a point-in-time snapshot (see syncHoldings.ts — each sync
// wholesale-replaces the rows), so this just reads whatever's currently
// stored for the given linked item, live via realtime subscription.
export function useInvestmentHoldings(itemId) {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const channelNameRef = useRef(`investment_holdings_changes_${itemId}_${crypto.randomUUID()}`);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('investment_holdings')
        .select('*')
        .eq('item_id', itemId)
        .order('value', { ascending: false });
      if (error) console.error('Failed to load holdings:', error);
      setHoldings((data || []).map(rowToHolding));
    } catch (err) {
      console.error('Failed to load holdings:', err);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    reload();
    let channel;
    try {
      channel = supabase
        .channel(channelNameRef.current)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'investment_holdings' }, () => reload())
        .subscribe();
    } catch (err) {
      console.error('Failed to subscribe to holdings changes:', err);
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [reload]);

  return { holdings, loading, reload };
}
