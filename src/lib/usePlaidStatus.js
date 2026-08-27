import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

// plaid_status lives on the public app_state row (safe to expose — just
// status flags per institution, not the actual Plaid access_token, which
// stays server-side only in plaid_items). Subscribes to realtime so the UI
// flips to "connected" right after linking, and "last synced" updates live.
export function usePlaidStatus(target) {
  const [linked, setLinked] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // Unique per mount so React's dev-mode double-invoke (or a real remount)
  // never tries to re-subscribe a channel name Supabase already has open.
  const channelNameRef = useRef(`plaid_status_changes_${target}_${crypto.randomUUID()}`);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_state')
        .select('plaid_status')
        .eq('id', 'main')
        .maybeSingle();
      if (error) throw error;
      const status = data?.plaid_status?.[target];
      setLinked(!!status?.linked);
      setLastSyncedAt(status?.lastSyncedAt ?? null);
    } catch (err) {
      console.error('Failed to load Plaid status:', err);
    }
  }, [target]);

  useEffect(() => {
    reload();
    let channel;
    try {
      channel = supabase
        .channel(channelNameRef.current)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_state' }, () => reload())
        .subscribe();
    } catch (err) {
      console.error('Failed to subscribe to Plaid status changes:', err);
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [reload]);

  return { linked, lastSyncedAt, reload };
}
