import { useState } from 'react';
import { SettingsIcon, RefreshIcon, SyncIcon } from './icons';

export default function TopBar({ appName = 'Family Budget', setView }) {
  const [syncing, setSyncing] = useState(false);

  // Refresh: reload the app so it re-reads the latest saved balances and
  // transactions from the database (e.g. after a change on another device).
  function refresh() {
    window.location.reload();
  }

  // Sync all: pull new transactions + balances from every linked bank, then
  // reload so they show up right away. Available from any page.
  async function syncAll() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sync failed.');
      window.location.reload();
    } catch (err) {
      setSyncing(false);
      window.alert(err.message || 'Sync failed. Please try again.');
    }
  }

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <span className="top-bar-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        {appName}
      </div>
      <div className="top-bar-actions">
        <button
          className={`top-bar-btn${syncing ? ' is-syncing' : ''}`}
          type="button"
          aria-label={syncing ? 'Syncing accounts…' : 'Sync all accounts'}
          title="Pull new transactions and balances from your banks"
          onClick={syncAll}
          disabled={syncing}
        >
          <SyncIcon />
          <span className="top-bar-btn-label">{syncing ? 'Syncing…' : 'Sync'}</span>
        </button>
        <button
          className="top-bar-btn"
          type="button"
          aria-label="Refresh the page"
          title="Reload the app with the latest saved data"
          onClick={refresh}
        >
          <RefreshIcon />
          <span className="top-bar-btn-label">Refresh</span>
        </button>
        <button
          className="top-bar-icon-btn"
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => setView?.('settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
