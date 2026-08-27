import { useState, useEffect, useCallback } from 'react';

// Manages the list of connected Gmail accounts via the /api/gmail/* endpoints.
export function useGmailAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/gmail/list');
      const data = await res.json().catch(() => ({}));
      if (res.ok) setAccounts(data.accounts || []);
    } catch (err) {
      console.error('Failed to load Gmail accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Kicks off Google sign-in by navigating the whole page to the consent URL.
  async function connect() {
    const res = await fetch('/api/gmail/auth-start', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Google sign-in.');
    window.location.href = data.url;
  }

  async function disconnect(email) {
    await fetch('/api/gmail/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    reload();
  }

  return { accounts, loading, reload, connect, disconnect };
}
