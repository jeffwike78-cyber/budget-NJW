import { OverviewIcon, TransactionsIcon, BudgetIcon, SinkingFundsIcon, AccountsIcon } from './icons';
import { signedBalance } from '../lib/budgetMath';

// Tax Report isn't a daily tab — it's reached from Settings (used once a year).
const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', Icon: OverviewIcon },
  { key: 'transactions', label: 'Transactions', Icon: TransactionsIcon },
  { key: 'budget', label: 'Budget', Icon: BudgetIcon },
  { key: 'sinking', label: 'Envelopes', Icon: SinkingFundsIcon },
  { key: 'accounts', label: 'Accounts', Icon: AccountsIcon },
];

function usd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function Sidebar({ view, setView, totalBalance, accounts = [] }) {
  return (
    <nav className="sidebar">
      <ul className="sidebar-nav">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <li key={key}>
            <button
              type="button"
              className={`sidebar-link${view === key ? ' active' : ''}`}
              onClick={() => setView(key)}
            >
              <Icon />
              {label}
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        {accounts.length > 0 && (
          <button
            type="button"
            className="sidebar-accounts"
            onClick={() => setView('accounts')}
            title="Manage accounts"
          >
            <span className="sidebar-accounts-title">Account balances</span>
            <ul className="sidebar-accounts-list">
              {accounts.map((a) => {
                const bal = signedBalance(a);
                return (
                  <li key={a.id} className="sidebar-account-row">
                    <span className="sidebar-account-name">{a.name}</span>
                    <span className={`sidebar-account-value${bal < 0 ? ' negative' : ''}`}>
                      {bal < 0 ? `-$${Math.abs(bal).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : usd(bal)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </button>
        )}
        <div className="sidebar-total-row">
          <span className="sidebar-footer-label">Total across accounts</span>
          <span className="sidebar-footer-value">{usd(totalBalance)}</span>
        </div>
      </div>
    </nav>
  );
}

export function MobileTabBar({ view, setView }) {
  return (
    <nav className="mobile-tab-bar">
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`mobile-tab-link${view === key ? ' active' : ''}`}
          onClick={() => setView(key)}
        >
          <Icon />
          {label}
        </button>
      ))}
    </nav>
  );
}
