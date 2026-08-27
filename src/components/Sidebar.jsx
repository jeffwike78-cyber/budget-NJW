import { OverviewIcon, TransactionsIcon, BudgetIcon, SinkingFundsIcon, ReportIcon, AccountsIcon } from './icons';

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview', Icon: OverviewIcon },
  { key: 'transactions', label: 'Transactions', Icon: TransactionsIcon },
  { key: 'budget', label: 'Budget', Icon: BudgetIcon },
  { key: 'sinking', label: 'Sinking Funds', Icon: SinkingFundsIcon },
  { key: 'reports', label: 'Tax Report', Icon: ReportIcon },
  { key: 'accounts', label: 'Accounts', Icon: AccountsIcon },
];

export default function Sidebar({ view, setView, totalBalance }) {
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
        <span className="sidebar-footer-label">Total across accounts</span>
        <span className="sidebar-footer-value">${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
