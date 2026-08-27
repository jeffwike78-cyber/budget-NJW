import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { supabase } from '../lib/supabaseClient';

// Chase is an OAuth institution, so completing login sends the browser away
// and back (see plaid-create-link-token's redirect_uri). The link_token has
// to survive that round trip, hence sessionStorage rather than plain state —
// a fresh page load wipes React state but not this. Keyed per target so
// linking Chase and Schwab in separate tabs/attempts can't clobber each other.
function linkTokenKey(target) {
  return `plaid_link_token_${target}`;
}

function isResumingOAuth() {
  return window.location.href.includes('oauth_state_id=');
}

export default function PlaidConnectButton({ target, label, onLinked }) {
  const storageKey = linkTokenKey(target);
  const [linkToken, setLinkToken] = useState(() => (isResumingOAuth() ? sessionStorage.getItem(storageKey) : null));
  const [status, setStatus] = useState(() => (isResumingOAuth() && sessionStorage.getItem(storageKey) ? 'linking' : 'idle'));

  async function startConnect() {
    setStatus('loading');
    const { data, error } = await supabase.functions.invoke('plaid-create-link-token', { body: { target } });
    if (error || !data?.link_token) {
      console.error('Failed to create link token:', error);
      setStatus('error');
      return;
    }
    sessionStorage.setItem(storageKey, data.link_token);
    setLinkToken(data.link_token);
  }

  const onPlaidSuccess = useCallback(
    async (public_token) => {
      setStatus('linking');
      sessionStorage.removeItem(storageKey);
      const { error } = await supabase.functions.invoke('plaid-exchange-token', { body: { public_token, target } });
      setLinkToken(null);
      if (error) {
        console.error('Failed to exchange token:', error);
        setStatus('error');
        return;
      }
      setStatus('idle');
      onLinked?.();
    },
    [onLinked, storageKey, target]
  );

  const onPlaidExit = useCallback(
    (err) => {
      sessionStorage.removeItem(storageKey);
      setLinkToken(null);
      setStatus(err ? 'error' : 'idle');
    },
    [storageKey]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: onPlaidExit,
    ...(isResumingOAuth() ? { receivedRedirectUri: window.location.href } : {}),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  // Once handled, drop the oauth_state_id query param so refreshing this page
  // doesn't try to resume the same (likely already-finished) OAuth flow again.
  useEffect(() => {
    if (isResumingOAuth() && ready) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    }
  }, [ready]);

  const idleLabel = label || 'Connect';
  const buttonLabel =
    status === 'loading' ? 'Connecting…' : status === 'linking' ? 'Finishing up…' : status === 'error' ? 'Try again' : idleLabel;

  return (
    <button className="secondary-btn" type="button" onClick={startConnect} disabled={status === 'loading' || status === 'linking'}>
      {buttonLabel}
    </button>
  );
}
