import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaidLink } from 'react-plaid-link';

// One shared Plaid Link controller for the Accounts page. It opens Link in two
// modes:
//   • connect — link a brand-new bank (exchanges a public token for an access
//     token stored server-side).
//   • update  — re-authenticate an EXISTING bank in place (pass its itemId).
//     This repairs a stale connection without removing the item, its accounts,
//     or the transactions already imported — no data is lost. On success there's
//     no token to exchange; we just re-sync the item.
//
// The link session (token + mode + itemId) is stashed in sessionStorage because
// some banks (Chase and other OAuth banks) redirect the browser away to log in
// and back — a page reload would otherwise lose which mode we were in.
const STORAGE_KEY = 'plaid_link_session';

function isResumingOAuth() {
  return window.location.href.includes('oauth_state_id=');
}
function loadResumed() {
  if (!isResumingOAuth()) return null;
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function usePlaidConnect({ onLinked } = {}) {
  const resumed = loadResumed();
  const [linkToken, setLinkToken] = useState(() => resumed?.token || null);
  const [status, setStatus] = useState(() => (resumed?.token ? 'linking' : 'idle'));
  const [error, setError] = useState(null);
  // Refs so the async onSuccess callback always sees the current mode/itemId,
  // even across an OAuth redirect (where they're restored from storage).
  const modeRef = useRef(resumed?.mode || 'connect');
  const itemIdRef = useRef(resumed?.itemId || null);

  // start() with no argument links a new bank; start(itemId) reconnects one.
  const start = useCallback(async (itemId = null) => {
    setStatus('loading');
    setError(null);
    const mode = itemId ? 'update' : 'connect';
    modeRef.current = mode;
    itemIdRef.current = itemId;
    try {
      const res = await fetch('/api/plaid/create-link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link_token) throw new Error(data.error || 'Could not start Plaid.');
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.link_token, mode, itemId }));
      setLinkToken(data.link_token);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  const onSuccess = useCallback(
    async (public_token, metadata) => {
      setStatus('linking');
      setError(null);
      sessionStorage.removeItem(STORAGE_KEY);
      try {
        if (modeRef.current === 'update') {
          // Update mode repaired the existing item — no token exchange. Just
          // pull fresh data for it; all prior transactions stay put.
          const res = await fetch('/api/plaid/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: itemIdRef.current }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not finish reconnecting.');
          setLinkToken(null);
          setStatus('idle');
          onLinked?.({ ...data, updated: true, itemId: itemIdRef.current });
        } else {
          const res = await fetch('/api/plaid/exchange-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              public_token,
              institution_name: metadata?.institution?.name,
              account_kind: metadata?.accounts?.[0]?.type,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not finish linking.');
          setLinkToken(null);
          setStatus('idle');
          onLinked?.(data);
        }
      } catch (err) {
        setLinkToken(null);
        setError(err.message);
        setStatus('error');
      }
    },
    [onLinked]
  );

  const onExit = useCallback((err) => {
    sessionStorage.removeItem(STORAGE_KEY);
    setLinkToken(null);
    setStatus(err ? 'error' : 'idle');
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
    ...(isResumingOAuth() ? { receivedRedirectUri: window.location.href } : {}),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  // Once Link is handling the OAuth return, drop oauth_state_id so a refresh
  // doesn't try to resume an already-finished flow.
  useEffect(() => {
    if (isResumingOAuth() && ready) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    }
  }, [ready]);

  return { start, status, error, busy: status === 'loading' || status === 'linking' };
}
