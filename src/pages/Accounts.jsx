import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useInvestmentHoldings } from '../lib/useInvestmentHoldings';
import PlaidConnectButton from '../components/PlaidConnectButton';

function timeAgo(isoString) {
  if (!isoString) return null;
  const minutes = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function BankConnectionCard({ title, target, plaid }) {
  const [syncing, setSyncing] = useState(false);
  const { linked, lastSyncedAt, reload } = plaid;

  async function syncNow() {
    setSyncing(true);
    const { error } = await supabase.functions.invoke('plaid-sync-transactions', { body: { target } });
    if (error) console.error('Manual sync failed:', error);
    await reload();
    setSyncing(false);
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>{title}</h2>
        {linked && <span className="pill pill-good">Connected</span>}
      </div>
      <div className="car-actions">
        {linked ? (
          <>
            <button className="secondary-btn" type="button" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            {lastSyncedAt && <span className="module-note">Last synced {timeAgo(lastSyncedAt)}</span>}
          </>
        ) : (
          <PlaidConnectButton target={target} label={`Connect ${title}`} onLinked={reload} />
        )}
      </div>
    </section>
  );
}

function HoldingsCard({ linked }) {
  const { holdings, loading } = useInvestmentHoldings('schwab');

  if (!linked) return null;

  const total = holdings.reduce((sum, h) => sum + h.value, 0);

  return (
    <section className="card">
      <div className="card-header">
        <h2>Schwab holdings</h2>
        <span className="pill">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} total</span>
      </div>
      {loading ? (
        <p className="module-note">Loading holdings…</p>
      ) : holdings.length === 0 ? (
        <p className="module-note">No holdings synced yet — click Sync now above.</p>
      ) : (
        <div className="holdings-list">
          {holdings.map((h) => (
            <div className="holdings-row" key={h.id}>
              <div className="holdings-name">
                <span>{h.securityName}</span>
                {h.ticker && <span className="holdings-ticker">{h.ticker}</span>}
              </div>
              {h.quantity != null && <span className="holdings-qty">{h.quantity.toLocaleString()} sh</span>}
              <span className="holdings-value">${h.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Accounts({ budgetState, setBudgetState, chasePlaid, schwabPlaid, marcusPlaid }) {
  function updateBalance(accountId, value) {
    setBudgetState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === accountId ? { ...a, balance: value } : a)),
    }));
  }

  const total = budgetState.accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);

  return (
    <>
      <h1 className="page-title">Accounts</h1>

      <BankConnectionCard title="Chase" target="chase" plaid={chasePlaid} />
      <BankConnectionCard title="Schwab" target="schwab" plaid={schwabPlaid} />
      <HoldingsCard linked={schwabPlaid.linked} />
      <BankConnectionCard title="Marcus by Goldman Sachs" target="marcus" plaid={marcusPlaid} />

      <section className="card">
        <div className="card-header">
          <h2>Account balances</h2>
          <span className="pill">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} total</span>
        </div>
        <div className="accounts-editor">
          {budgetState.accounts.map((a) => (
            <div className="accounts-editor-row" key={a.id}>
              <div>
                <div className="accounts-editor-name">{a.name}</div>
                <div className="accounts-editor-type">{a.type}</div>
              </div>
              <span className="accounts-editor-balance">
                $
                <input
                  type="number"
                  className="budget-input"
                  value={a.balance}
                  onChange={(e) => updateBalance(a.id, e.target.value)}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="module-note">Balances sync automatically for connected accounts above; edit here for anything unconnected.</p>
      </section>
    </>
  );
}
