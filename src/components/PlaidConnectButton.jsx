import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';

// The link_token has to survive an OAuth round-trip (some banks send the
// browser away to log in and back), so it's stashed in sessionStorage rather
// than plain React state, which a page reload would wipe.
const STORAGE_KEY = 'plaid_link_token';

function isResumingOAuth() {
  return window.location.href.includes('oauth_state_id=');
}

export default function PlaidConnectButton({ label = 'Connect a bank', onLinked }) {
  const [linkToken, setLinkToken] = useState(() => (isResumingOAuth() ? sessionStorage.getItem(STORAGE_KEY) : null));
  const [status, setStatus] = useState(() =>
    isResumingOAuth() && sessionStorage.getItem(STORAGE_KEY) ? 'linking' : 'idle'
  );
  const [error, setError] = useState(null);

  async function startConnect() {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/plaid/create-link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link_token) throw new Error(data.error || 'Could not start Plaid.');
      sessionStorage.setItem(STORAGE_KEY, data.link_token);
      setLinkToken(data.link_token);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  const onPlaidSuccess = useCallback(
    async (public_token, metadata) => {
      setStatus('linking');
      setError(null);
      sessionStorage.removeItem(STORAGE_KEY);
      try {
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
      } catch (err) {
        setLinkToken(null);
        setError(err.message);
        setStatus('error');
      }
    },
    [onLinked]
  );

  const onPlaidExit = useCallback((err) => {
    sessionStorage.removeItem(STORAGE_KEY);
    setLinkToken(null);
    setStatus(err ? 'error' : 'idle');
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: onPlaidExit,
    ...(isResumingOAuth() ? { receivedRedirectUri: window.location.href } : {}),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  // Once handled, drop the oauth_state_id param so a refresh doesn't try to
  // resume an already-finished OAuth flow.
  useEffect(() => {
    if (isResumingOAuth() && ready) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    }
  }, [ready]);

  const buttonLabel =
    status === 'loading'
      ? 'Starting…'
      : status === 'linking'
      ? 'Finishing…'
      : status === 'error'
      ? 'Try again'
      : label;

  return (
    <div className="plaid-connect">
      <button
        className="primary-btn"
        type="button"
        onClick={startConnect}
        disabled={status === 'loading' || status === 'linking'}
      >
        {buttonLabel}
      </button>
      {error && <span className="module-note form-error">{error}</span>}
    </div>
  );
}
