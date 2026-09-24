import { useState, useEffect, useCallback } from 'react';
import { makeDefaultBudget } from '../lib/useBudgetState';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/useAuth';
import { listBudgetVersions, summarizeBudget } from '../lib/budgetHistory';

// One place for the knobs that don't belong on a specific page: what the app
// is called, when the envelope ledger starts counting, how you pay for things,
// and a guarded reset back to the seeded budget.
export default function Settings({ budgetState, setBudgetState, setView }) {
  const settings = budgetState.settings || {};
  const { user } = useAuth();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetText, setResetText] = useState('');
  const [copied, setCopied] = useState(false);

  function updateSetting(patch) {
    setBudgetState((prev) => ({ ...prev, settings: { ...(prev.settings || {}), ...patch } }));
  }

  // --- Voice / Siri: a private token an Apple Shortcut sends to read balances ---
  const voiceToken = settings.voiceToken || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const voiceUrl = voiceToken ? `${origin}/api/envelope-balance?token=${voiceToken}&category=groceries` : '';
  function generateVoiceToken() {
    const rand =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    updateSetting({ voiceToken: rand });
  }
  function copyVoiceUrl() {
    navigator.clipboard?.writeText(voiceUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Download the whole budget as a JSON file — an off-app backup the user keeps.
  function exportBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(budgetState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function cancelReset() {
    setConfirmReset(false);
    setResetText('');
  }

  function resetToDefaults() {
    if (resetText.trim().toUpperCase() !== 'RESET') return;
    setBudgetState(makeDefaultBudget());
    cancelReset();
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

      <section className="card">
        <div className="card-header">
          <h2>Voice &amp; Siri</h2>
        </div>
        <p className="module-note">
          Ask Siri how much is left in any envelope. Generate a private token, then set up a one-time Apple
          Shortcut that calls your budget and speaks the answer. Anyone with this link can read your balances, so
          keep it private — you can rotate it anytime.
        </p>
        {!voiceToken ? (
          <button type="button" className="secondary-btn" onClick={generateVoiceToken}>
            Generate voice token
          </button>
        ) : (
          <>
            <div className="settings-field">
              <label htmlFor="voice-url">Your Shortcut URL (asks about “groceries”)</label>
              <div className="voice-url-row">
                <input id="voice-url" type="text" readOnly value={voiceUrl} onFocus={(e) => e.target.select()} />
                <button type="button" className="secondary-btn" onClick={copyVoiceUrl}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <p className="module-note">
                Swap <code>category=groceries</code> for any envelope name.
              </p>
            </div>
            <ol className="voice-steps">
              <li>On your iPhone, open <strong>Shortcuts</strong> → tap <strong>+</strong> → <strong>Add Action</strong>.</li>
              <li>Add <strong>Get Contents of URL</strong> and paste the URL above.</li>
              <li>Add <strong>Speak Text</strong> underneath — it reads the reply aloud.</li>
              <li>Name it e.g. <strong>“Grocery budget.”</strong> Then just say <strong>“Hey Siri, Grocery budget.”</strong></li>
              <li>
                Optional — to ask about <em>any</em> envelope by voice: add a <strong>Dictate Text</strong> action first,
                then in the URL replace <code>groceries</code> with that dictated text.
              </li>
            </ol>
            <button
              type="button"
              className="link-btn danger"
              onClick={() => {
                if (window.confirm('Rotate the token? Your existing Shortcut will stop working until you paste the new URL into it.')) {
                  generateVoiceToken();
                }
              }}
            >
              Rotate token
            </button>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Income categories</h2>
        </div>
        <p className="module-note">
          Labels for money coming in (paycheck, a one-off extra, a reimbursement…). These don&apos;t affect your
          budget or envelopes — they&apos;re just how a deposit gets tagged, so you can tell expected income from
          extra. Pick one on any deposit in Transactions.
        </p>
        <IncomeCategoriesEditor budgetState={budgetState} setBudgetState={setBudgetState} />
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Tax Report</h2>
        </div>
        <p className="module-note">
          Year-end totals by tax bucket (charitable, medical, business), with receipt detail and a CSV
          export for your CPA. Lives here since it&apos;s used once a year, not day to day.
        </p>
        <button type="button" className="secondary-btn" onClick={() => setView?.('reports')}>
          Open Tax Report →
        </button>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Account</h2>
        </div>
        <p className="module-note">
          {user?.email ? (
            <>Signed in as <strong>{user.email}</strong>. Everyone in the family shares this one budget.</>
          ) : (
            'You are signed in.'
          )}
        </p>
        <PasskeyManager />
        <button type="button" className="secondary-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Back up your budget</h2>
        </div>
        <p className="module-note">
          Download a copy of your entire budget setup — envelopes, sinking funds, income, accounts,
          and settings — as a JSON file. Keep it somewhere safe (it&apos;s an off-app backup you can
          restore from if anything ever goes wrong).
        </p>
        <button type="button" className="primary-btn" onClick={exportBackup}>
          ⬇ Export a backup
        </button>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Budget history &amp; restore</h2>
        </div>
        <BudgetHistory setBudgetState={setBudgetState} />
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
          <div className="settings-field">
            <label htmlFor="reset-confirm">
              Type <strong>RESET</strong> to confirm you want to wipe your budget setup:
            </label>
            <input
              id="reset-confirm"
              type="text"
              value={resetText}
              placeholder="RESET"
              autoComplete="off"
              onChange={(e) => setResetText(e.target.value)}
            />
            <div className="bank-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="link-btn danger"
                disabled={resetText.trim().toUpperCase() !== 'RESET'}
                onClick={resetToDefaults}
              >
                Permanently reset the budget
              </button>
              <button type="button" className="secondary-btn" onClick={cancelReset}>
                Cancel
              </button>
            </div>
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

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// Lists saved budget versions (from app_state_history) and lets you roll back to
// one. Restoring first snapshots the current version, so it's reversible.
function BudgetHistory({ setBudgetState }) {
  const [state, setState] = useState({ loading: true, installed: true, versions: [] });
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const { installed, versions } = await listBudgetVersions(30);
    setState({ loading: false, installed, versions });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(v) {
    const when = fmtWhen(v.saved_at);
    if (!window.confirm(`Restore the budget from ${when}? Your current budget is saved to history first, so you can undo this.`)) return;
    setMsg(null);
    setBudgetState(v.budget);
    setMsg(`Restored the version from ${when} ✓`);
    // The restore just created a new history entry (the prior version), so refresh.
    setTimeout(load, 600);
  }

  if (state.loading) return <p className="module-note">Loading saved versions…</p>;

  if (!state.installed) {
    return (
      <p className="module-note">
        Version history isn&apos;t turned on yet. Run <code>supabase/budget-history.sql</code> once in Supabase →
        SQL Editor, and every budget change from then on will be listed here to restore with one tap.
      </p>
    );
  }

  return (
    <>
      <p className="module-note">
        Every time the budget changes, the previous version is saved here automatically. Tap <strong>Restore</strong>{' '}
        to roll back — your current version is snapshotted first, so a restore can be undone.
      </p>
      {msg && <p className="module-note form-ok" role="status">{msg}</p>}
      {state.versions.length === 0 ? (
        <p className="module-note">No saved versions yet. They&apos;ll appear here the next time the budget changes.</p>
      ) : (
        <ul className="history-list">
          {state.versions.map((v) => {
            const s = summarizeBudget(v.budget);
            const open = openId === v.id;
            return (
              <li key={v.id} className="history-row">
                <div className="history-main">
                  <div className="history-info">
                    <span className="history-when">{fmtWhen(v.saved_at)}</span>
                    <span className="history-summary">
                      {s.categoryCount} envelopes · {s.accountCount} accounts · ${s.monthlyFixed.toLocaleString()}/mo fixed
                    </span>
                  </div>
                  <div className="history-actions">
                    <button type="button" className="link-btn" onClick={() => setOpenId(open ? null : v.id)}>
                      {open ? 'Hide' : 'Preview'}
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => restore(v)}>
                      Restore
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="history-preview">
                    {s.names.length ? s.names.join(' · ') : 'No envelopes in this version.'}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function IncomeCategoriesEditor({ budgetState, setBudgetState }) {
  const cats = budgetState.incomeCategories || [];
  const [name, setName] = useState('');

  function update(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      incomeCategories: (prev.incomeCategories || []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }
  function remove(id) {
    setBudgetState((prev) => ({
      ...prev,
      incomeCategories: (prev.incomeCategories || []).filter((c) => c.id !== id),
    }));
  }
  function add(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBudgetState((prev) => ({
      ...prev,
      incomeCategories: [...(prev.incomeCategories || []), { id: `inc-${Date.now()}`, name: n }],
    }));
    setName('');
  }

  return (
    <div className="income-cat-editor">
      {cats.map((c) => (
        <div className="income-cat-row" key={c.id}>
          <input value={c.name} onChange={(e) => update(c.id, { name: e.target.value })} />
          <button type="button" className="link-btn danger" onClick={() => remove(c.id)}>
            Remove
          </button>
        </div>
      ))}
      <form className="add-inline-form" onSubmit={add}>
        <input placeholder="New income category" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="secondary-btn">
          + Add
        </button>
      </form>
    </div>
  );
}

// Lets a signed-in person add a passkey (Face ID / fingerprint / device PIN) on
// this device so next time they can open the app with one tap instead of typing
// a password. Passkeys are tied to the production domain, so set them up there.
function PasskeyManager() {
  const [passkeys, setPasskeys] = useState([]);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw error;
      setPasskeys(data || []);
    } catch {
      // Older SDK, experimental flag off, or an unsupported browser.
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      setMsg('Passkey added — you can now open the app with Face ID / fingerprint on this device.');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not add a passkey on this device.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setErr(null);
    setMsg(null);
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(e.message || 'Could not remove that passkey.');
    }
  }

  if (!supported) {
    return (
      <p className="module-note">
        Passkeys aren&apos;t available on this device or browser — you can still use email/password or Google.
      </p>
    );
  }

  return (
    <div className="passkey-manager">
      <div className="passkey-head">
        <span className="passkey-title">Passkeys on this device</span>
        <button type="button" className="secondary-btn" onClick={add} disabled={busy}>
          {busy ? 'Setting up…' : '＋ Add a passkey'}
        </button>
      </div>
      {passkeys.length > 0 ? (
        <ul className="passkey-list">
          {passkeys.map((p) => (
            <li key={p.id} className="passkey-row">
              <span className="passkey-name">
                {p.friendly_name || 'Passkey'}
                {p.created_at ? ` · added ${new Date(p.created_at).toLocaleDateString()}` : ''}
              </span>
              <button type="button" className="link-btn danger" onClick={() => remove(p.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="module-note">
          No passkeys yet. Add one here, then use <strong>Sign in with a passkey</strong> on the login
          screen for one-tap access. Set this up on your production app URL, on each phone.
        </p>
      )}
      {msg && <p className="module-note form-ok" role="status">{msg}</p>}
      {err && <p className="module-note form-error" role="alert">{err}</p>}
    </div>
  );
}
