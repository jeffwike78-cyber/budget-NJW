import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

// Reads the list of linked banks from the public app_state.plaid_status map
// (safe to expose — just status flags per institution, never the Plaid access
// tokens, which stay server-side in plaid_items). Subscribes to realtime so
// the list and "last synced" times update live after linking or a sync.
export function useConnectedBanks() {
  const [banks, setBanks] = useState([]);
  const channelNameRef = useRef(`plaid_status_${crypto.randomUUID()}`);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_state')
        .select('plaid_status')
        .eq('id', 'main')
        .maybeSingle();
      if (error) throw error;
      const status = data?.plaid_status || {};
      setBanks(Object.entries(status).map(([itemId, v]) => ({ itemId, ...v })));
    } catch (err) {
      console.error('Failed to load connected banks:', err);
    }
  }, []);

  useEffect(() => {
    reload();
    let channel;
    try {
      channel = supabase
        .channel(channelNameRef.current)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_state' }, () => reload())
        .subscribe();
    } catch (err) {
      console.error('Failed to subscribe to bank status changes:', err);
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [reload]);

  return { banks, reload };
}
