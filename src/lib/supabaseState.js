import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

const ROW_ID = 'main';

// Same interface as the old localStorage-backed useStored: [value, setValue] where
// setValue accepts either a value or an updater function. Persists to a single
// shared row in Supabase instead of the browser's localStorage, so data now
// follows the deployed app rather than the device — no accounts involved.
export function useSupabaseState(column, defaultValue) {
  const [data, setData] = useState(defaultValue);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: row, error } = await supabase
        .from('app_state')
        .select(column)
        .eq('id', ROW_ID)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.error(`Failed to load ${column}:`, error);
      // The column defaults to '{}'::jsonb at the database level (see schema.sql),
      // which is truthy and non-null — so `??` alone doesn't catch it. A module's
      // saved state is never actually an empty object (every DEFAULT_STATE has real
      // keys), so treat "no keys" the same as "nothing saved yet" and use defaultValue.
      const value = row?.[column];
      const isEmpty = value == null || (typeof value === 'object' && Object.keys(value).length === 0);
      setData(isEmpty ? defaultValue : value);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  const update = useCallback(
    (next) => {
      setData((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        supabase
          .from('app_state')
          .upsert({ id: ROW_ID, [column]: resolved, updated_at: new Date().toISOString() })
          .then(({ error }) => {
            if (error) console.error(`Failed to save ${column}:`, error);
          });
        return resolved;
      });
    },
    [column]
  );

  return [data, update, loading];
}
