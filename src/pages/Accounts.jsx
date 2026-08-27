import { useState } from 'react';

const ACCOUNT_TYPES = ['checking', 'savings', 'investing', 'credit'];

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function Accounts({ budgetState, setBudgetState }) {
  const [showAdd, setShowAdd] = useState(false);
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

  return (
    <>
      <h1 className="page-title">Accounts</h1>

      <section className="card info-card">
        <div className="card-header">
          <h2>Automatic bank sync</h2>
          <span className="pill">Coming soon</span>
        </div>
        <p className="module-note">
          Connecting your real banks and cards (so transactions import and categorize themselves) is
          Phase 3 of your setup. Until it's turned on, add your accounts here and keep their balances
          current — everything else in the app already works.
        </p>
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
    onAdd({
      id: `acct-${Date.now()}`,
      name: name.trim(),
      type,
      balance: Number(balance || 0),
    });
  }

  return (
    <form className="add-inline-form" onSubmit={submit}>
      <input
        placeholder="Account name (e.g. Chase Checking)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {ACCOUNT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        type="number"
        placeholder="Balance"
        value={balance}
        onChange={(e) => setBalance(e.target.value)}
      />
      <button type="submit" className="primary-btn">
        Add
      </button>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
