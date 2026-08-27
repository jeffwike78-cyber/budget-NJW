import { useState } from 'react';
import PlaidConnectButton from '../components/PlaidConnectButton';
import { useConnectedBanks } from '../lib/useConnectedBanks';

const ACCOUNT_TYPES = ['checking', 'savings', 'investing', 'credit'];

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Accounts({ budgetState, setBudgetState }) {
  const [showAdd, setShowAdd] = useState(false);
  const { banks, reload: reloadBanks } = useConnectedBanks();
  const [syncingId, setSyncingId] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);
  const accounts = budgetState.accounts || [];
  const total = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);

  function updateAccount(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  function deleteAccount(id) {
    setBudgetState((prev) => ({ ...prev, accounts: prev.accounts.filter((a) => a.id !== id) }));
  }

  function addAccount(account) {
    setBudgetState((prev) => ({ ...prev, accounts: [...(prev.accounts || []), account] }));
    setShowAdd(false);
  }

  async function syncBank(itemId) {
    setSyncingId(itemId || 'all');
    setSyncMsg(null);
    try {
      const res = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sync failed.');
      const totalSynced = Object.values(data.results || {}).reduce((s, r) => s + (r?.synced || 0), 0);
      setSyncMsg(totalSynced > 0 ? `Synced ${totalSynced} transaction${totalSynced === 1 ? '' : 's'}.` : 'Up to date — no new transactions.');
      reloadBanks();
    } catch (err) {
      setSyncMsg(err.message);
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <>
      <h1 className="page-title">Accounts</h1>

      <section className="card">
        <div className="card-header">
          <h2>Bank sync</h2>
          {banks.length > 0 && <span className="pill pill-good">{banks.length} connected</span>}
        </div>
        <p className="module-note">
          Connect a bank or card and transactions import automatically — the AI files each one into the
          right envelope, and only the unsure ones land in Needs Review.
        </p>

        {banks.length > 0 && (
          <ul className="bank-list">
            {banks.map((b) => (
              <li key={b.itemId} className="bank-row">
                <div className="bank-info">
                  <span className="bank-name">{b.institutionName || 'Bank'}</span>
                  <span className="bank-synced">Last synced {timeAgo(b.lastSyncedAt)}</span>
                </div>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => syncBank(b.itemId)}
                  disabled={syncingId !== null}
                >
                  {syncingId === b.itemId ? 'Syncing…' : 'Sync now'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="bank-actions">
          <PlaidConnectButton
            label={banks.length > 0 ? 'Connect another bank' : 'Connect a bank'}
            onLinked={() => {
              reloadBanks();
              setSyncMsg('Bank connected — pulling in your transactions.');
            }}
          />
          {syncMsg && <span className="module-note ai-status">{syncMsg}</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Your accounts</h2>
          <span className="pill">{money(total)} total</span>
        </div>

        <div className="accounts-editor">
          {accounts.map((a) => (
            <div className="accounts-editor-row" key={a.id}>
              <input
                className="account-name-input"
                value={a.name}
                onChange={(e) => updateAccount(a.id, { name: e.target.value })}
              />
              <select
                className="account-type-select"
                value={a.type}
                onChange={(e) => updateAccount(a.id, { type: e.target.value })}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="accounts-editor-balance">
                $
                <input
                  type="number"
                  className="budget-input"
                  value={a.balance}
                  onChange={(e) => updateAccount(a.id, { balance: e.target.value })}
                />
              </span>
              <button type="button" className="link-btn danger" onClick={() => deleteAccount(a.id)}>
                Remove
              </button>
            </div>
          ))}
          {accounts.length === 0 && <p className="module-note">No accounts yet — add one below.</p>}
        </div>

        {showAdd ? (
          <AddAccountForm onAdd={addAccount} onCancel={() => setShowAdd(false)} />
        ) : (
          <button type="button" className="secondary-btn" onClick={() => setShowAdd(true)}>
            + Add account
          </button>
        )}
      </section>
    </>
  );
}

function AddAccountForm({ onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [balance, setBalance] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ id: `acct-${Date.now()}`, name: name.trim(), type, balance: Number(balance || 0) });
  }

  return (
    <form className="add-inline-form" onSubmit={submit}>
      <input placeholder="Account name (e.g. Chase Checking)" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {ACCOUNT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input type="number" placeholder="Balance" value={balance} onChange={(e) => setBalance(e.target.value)} />
      <button type="submit" className="primary-btn">
        Add
      </button>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
