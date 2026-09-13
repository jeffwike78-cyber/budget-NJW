import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

const ROW_ID = 'main';
const MAX_MERGE_RETRIES = 3;

// Which top-level sections of the value differ between two objects. Used to tell
// "what this client changed" from "what someone/something else changed" so a
// save only overwrites the sections it actually touched.
function changedKeys(a, b) {
  const base = a && typeof a === 'object' ? a : {};
  const next = b && typeof b === 'object' ? b : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  const out = [];
  for (const k of keys) {
    if (JSON.stringify(base[k]) !== JSON.stringify(next[k])) out.push(k);
  }
  return out;
}

// Same interface as the old localStorage-backed useStored, plus two extra return
// values for conflict handling: [value, setValue, loading, conflict, clearConflict].
// Persists to a single shared row in Supabase.
//
// Concurrency: the shared row has no per-user copy, so a naive save is
// last-write-wins — a stale tab (or an old device) could overwrite newer data,
// which is exactly how the budget was lost once. Every write is now a
// compare-and-set against the row's `updated_at` as it was last read:
//   - No conflict → the write lands and we remember the new `updated_at`.
//   - Conflict, but this client and the other writer changed DIFFERENT sections
//     (the common case: the user edits envelopes while a background bank sync
//     rewrites `accounts`) → merge automatically, overlaying only the sections
//     this client changed onto the latest row, so nothing is clobbered.
//   - Conflict on the SAME section (two people editing the same thing) → do NOT
//     overwrite. Load the latest and raise `conflict` so the UI can tell the
//     user their last change didn't save and to re-enter it.
export function useSupabaseState(column, defaultValue, normalize) {
  const [data, setData] = useState(defaultValue);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState(false);
  // The row's `updated_at` as we last saw it — the compare-and-set token. Held
  // in a ref so the async save path always reads the current value.
  const tokenRef = useRef(null);
  const clearConflict = useCallback(() => setConflict(false), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: row, error } = await supabase
        .from('app_state')
        .select(`${column}, updated_at`)
        .eq('id', ROW_ID)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.error(`Failed to load ${column}:`, error);
      tokenRef.current = row?.updated_at ?? null;
      // The column defaults to '{}'::jsonb at the database level (see schema.sql),
      // which is truthy and non-null — so `??` alone doesn't catch it. A module's
      // saved state is never actually an empty object (every DEFAULT_STATE has real
      // keys), so treat "no keys" the same as "nothing saved yet" and use defaultValue.
      const value = row?.[column];
      const isEmpty = value == null || (typeof value === 'object' && Object.keys(value).length === 0);
      const resolved = isEmpty ? defaultValue : value;
      // A half-written row (e.g. a budget saved with accounts but no categories)
      // would otherwise leave the app unusable — normalize fills any missing/empty
      // sections from the defaults while keeping whatever real data is present.
      setData(normalize ? normalize(resolved) : resolved);
      setLoading(false);
    }
    // The data is behind RLS scoped to signed-in users, so only query once
    // there's a session. onAuthStateChange fires immediately with the restored
    // session (or null) and again on login, so this both loads on start and
    // refreshes right after sign-in.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) load();
      else setLoading(false);
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  // Write `resolved` to the row. `prev` is what this client had loaded before the
  // change, used to work out which sections it actually changed on a conflict.
  const persist = useCallback(
    async (prev, resolved, attempt = 0) => {
      const stamp = new Date().toISOString();
      // No baseline token yet (row never loaded / fresh install) → plain upsert.
      if (tokenRef.current == null) {
        const { data: rows, error } = await supabase
          .from('app_state')
          .upsert({ id: ROW_ID, [column]: resolved, updated_at: stamp })
          .select('updated_at');
        if (error) console.error(`Failed to save ${column}:`, error);
        else if (rows?.length) tokenRef.current = rows[0].updated_at;
        return;
      }

      // Compare-and-set: only write if the row is still at the token we last saw.
      const { data: rows, error } = await supabase
        .from('app_state')
        .update({ [column]: resolved, updated_at: stamp })
        .eq('id', ROW_ID)
        .eq('updated_at', tokenRef.current)
        .select('updated_at');
      if (error) {
        console.error(`Failed to save ${column}:`, error);
        return;
      }
      if (rows?.length) {
        // Landed cleanly.
        tokenRef.current = rows[0].updated_at;
        setConflict(false);
        return;
      }

      // The row moved since we loaded it. Fetch the latest and reconcile.
      const { data: row } = await supabase
        .from('app_state')
        .select(`${column}, updated_at`)
        .eq('id', ROW_ID)
        .maybeSingle();
      tokenRef.current = row?.updated_at ?? null;
      const latest = row?.[column];
      if (!latest || typeof latest !== 'object' || tokenRef.current == null) {
        // Nothing coherent to merge against — fall back to an upsert.
        tokenRef.current = null;
        return persist(prev, resolved, attempt);
      }

      const ours = changedKeys(prev, resolved);
      const theirs = changedKeys(prev, latest);
      const overlap = ours.filter((k) => theirs.includes(k));

      if (overlap.length === 0 && attempt < MAX_MERGE_RETRIES) {
        // Disjoint changes → safe to merge: start from the latest row, then
        // overlay only the sections this client changed (add/replace or delete).
        const merged = { ...latest };
        for (const k of ours) {
          if (k in resolved) merged[k] = resolved[k];
          else delete merged[k];
        }
        const { data: rows2, error: err2 } = await supabase
          .from('app_state')
          .update({ [column]: merged, updated_at: new Date().toISOString() })
          .eq('id', ROW_ID)
          .eq('updated_at', tokenRef.current)
          .select('updated_at');
        if (err2) {
          console.error(`Failed to save ${column}:`, err2);
          return;
        }
        if (rows2?.length) {
          tokenRef.current = rows2[0].updated_at;
          setConflict(false);
          // Adopt the merged result locally (so server-written sections like
          // account balances show), unless the user has since edited again — in
          // which case that newer edit will save and reconcile on its own.
          setData((cur) => (cur === resolved ? merged : cur));
          return;
        }
        // Someone else raced us again — recompute against the newer latest.
        return persist(prev, resolved, attempt + 1);
      }

      // Same-section conflict (or retries exhausted): don't clobber the other
      // writer. Load the latest and flag it so the UI can prompt a re-entry.
      setData((cur) => (cur === resolved ? (normalize ? normalize(latest) : latest) : cur));
      setConflict(true);
    },
    [column, normalize]
  );

  const update = useCallback(
    (next) => {
      setData((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        void persist(prev, resolved);
        return resolved;
      });
    },
    [persist]
  );

  return [data, update, loading, conflict, clearConflict];
}
