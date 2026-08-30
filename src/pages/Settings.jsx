import { useState } from 'react';
import { makeDefaultBudget } from '../lib/useBudgetState';

// One place for the knobs that don't belong on a specific page: what the app
// is called, when the envelope ledger starts counting, how you pay for things,
// and a guarded reset back to the seeded budget.
export default function Settings({ budgetState, setBudgetState }) {
  const settings = budgetState.settings || {};
  const [confirmReset, setConfirmReset] = useState(false);

  function updateSetting(patch) {
    setBudgetState((prev) => ({ ...prev, settings: { ...(prev.settings || {}), ...patch } }));
  }

  function resetToDefaults() {
    setBudgetState(makeDefaultBudget());
    setConfirmReset(false);
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>

      <section className="card">
        <div className="card-header">
          <h2>General</h2>
        </div>
        <div className="settings-field">
          <label htmlFor="set-appname">Budget name</label>
          <input
            id="set-appname"
            type="text"
            value={settings.appName || ''}
            placeholder="Family Budget"
            onChange={(e) => updateSetting({ appName: e.target.value })}
          />
          <p className="module-note">Shown in the top bar.</p>
        </div>
        <div className="settings-field">
          <label htmlFor="set-startmonth">Ledger start month</label>
          <input
            id="set-startmonth"
            type="month"
            value={settings.startMonth || '2026-09'}
            onChange={(e) => updateSetting({ startMonth: e.target.value })}
          />
          <p className="module-note">
            The month your envelope balances begin accruing. Carryover envelopes fund one month&apos;s budget
            for every month from here forward. Set this to the month you go live.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Budgeting style</h2>
        </div>
        <p className="module-note">
          How you pay for things. Option 2 adds a credit-card payoff safety check on the Overview.
        </p>
        <div className="paymode-options">
          <label className="paymode-option">
            <input
              type="radio"
              name="paymode"
              checked={(settings.payMode || 'checking') === 'checking'}
              onChange={() => updateSetting({ payMode: 'checking' })}
            />
            <span>
              <strong>Option 1 — Pay from checking.</strong> Income lands in checking; bills are paid from it directly.
            </span>
          </label>
          <label className="paymode-option">
            <input
              type="radio"
              name="paymode"
              checked={settings.payMode === 'card'}
              onChange={() => updateSetting({ payMode: 'card' })}
            />
            <span>
              <strong>Option 2 — Put expenses on a credit card</strong> (for points), pay it off monthly from checking.
            </span>
          </label>
        </div>
      </section>

      <section className="card danger-zone">
        <div className="card-header">
          <h2>Danger zone</h2>
        </div>
        <p className="module-note">
          Reset every envelope, account, income source, and setting back to the seeded starting budget.
          This does <strong>not</strong> touch your recorded transactions. There&apos;s no undo.
        </p>
        {confirmReset ? (
          <div className="bank-actions">
            <button type="button" className="link-btn danger" onClick={resetToDefaults}>
              Yes, reset the budget to defaults
            </button>
            <button type="button" className="secondary-btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="secondary-btn" onClick={() => setConfirmReset(true)}>
            Reset budget to defaults…
          </button>
        )}
      </section>
    </>
  );
}
