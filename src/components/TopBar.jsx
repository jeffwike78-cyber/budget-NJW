import { UserIcon, HelpIcon, SettingsIcon, LogoutIcon } from './icons';

export default function TopBar() {
  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <span className="top-bar-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        BudgetTemplate
      </div>
      <div className="top-bar-actions">
        <button className="top-bar-icon-btn" type="button" aria-label="Profile">
          <UserIcon />
        </button>
        <button className="top-bar-icon-btn" type="button" aria-label="Help">
          <HelpIcon />
        </button>
        <button className="top-bar-icon-btn" type="button" aria-label="Settings">
          <SettingsIcon />
        </button>
        <button className="top-bar-icon-btn" type="button" aria-label="Log out">
          <LogoutIcon />
        </button>
      </div>
    </header>
  );
}
