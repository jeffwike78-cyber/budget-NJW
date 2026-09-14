import { useState, useEffect } from 'react';
import { usePlaidConnect } from '../lib/usePlaidConnect';
import { useConnectedBanks } from '../lib/useConnectedBanks';
import { useGmailAccounts } from '../lib/useGmailAccounts';
import { signedBalance, includeInCashOnHand, isLiability, LIABILITY_TYPES } from '../lib/budgetMath';
import { computeNetWorth, propertyEquity } from '../lib/netWorth';

const ACCOUNT_TYPES = ['checking', 'savings', 'investing', 'asset', 'credit', 'liability'];
const TYPE_LABEL = {
  checking: 'checking',
  savings: 'savings',
  investing: 'investing',
  asset: 'asset (home, vehicle…)',
  credit: 'credit card',
  liability: 'loan / liability',
};

// Errors that clear up on their own (the bank is briefly unreachable, or Plaid
// is still settling a freshly linked account's data). These should NOT tell the
// user to reconnect — reconnecting doesn't help and can create duplicate
// accounts. A plain "still importing, will retry" note is shown instead.
const TRANSIENT_ERROR_CODES = new Set([
  'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
  'INSTITUTION_NOT_RESPONDING',
  'INSTITUTION_NOT_AVAILABLE',
  'INSTITUTION_DOWN',
  'INTERNAL_SERVER_ERROR',
  'RATE_LIMIT_EXCEEDED',
  'PRODUCT_NOT_READY',
  'PLAID_GATEWAY_TIMEOUT',
]);

function money(n) {
  const v = Number(n || 0);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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
  const { accounts: emailAccounts, reload: reloadEmail, connect: connectGmail, disconnect: disconnectGmail } = useGmailAccounts();
  const [emailMsg, setEmailMsg] = useState(null);
  // Transaction audit (find/remove imported rows the bank no longer has).
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditMsg, setAuditMsg] = useState(null);
  const [auditFound, setAuditFound] = useState(null); // null = not run; [] = clean
  const [auditSelected, setAuditSelected] = useState(new Set()); // ids checked for removal

  const { start: startPlaid, busy: plaidBusy, error: plaidError } = usePlaidConnect({
    onLinked: (data) => {
      reloadBanks();
      setSyncMsg(
        data?.updated
          ? 'Reconnected — resynced in place, no transactions lost.'
          : 'Bank connected — pulling in your transactions.'
      );
    },
  });

  // After returning from Google, show a note and refresh the account list.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('gmail');
    if (!flag) return;
    setEmailMsg(flag === 'connected' ? 'Gmail account connected.' : 'Google sign-in was cancelled or failed.');
    reloadEmail();
    params.delete('gmail');
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.history.replaceState({}, '', url.toString());
  }, [reloadEmail]);

  async function startGmailConnect() {
    setEmailMsg(null);
    try {
      await connectGmail();
    } catch (err) {
      setEmailMsg(err.message);
    }
  }
  // Preview the audit: list the duplicate candidates and pre-check them all, so
  // the user can uncheck any legitimate ones before removing.
  async function previewAudit() {
    setAuditBusy(true);
    setAuditMsg(null);
    try {
      const res = await fetch('/api/plaid/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Audit failed.');
      const found = data.removed || [];
      setAuditFound(found);
      setAuditSelected(new Set(found.map((t) => t.id)));
      const dupWarning = data.multiAccount
        ? ' Heads up: some duplicates span two accounts, which usually means the same bank is connected twice — after removing these, check the connected banks below and disconnect the redundant one so it doesn’t come back.'
        : '';
      setAuditMsg(
        data.count === 0
          ? 'No duplicates found — every imported transaction still matches your bank. ✓'
          : `Found ${data.count} duplicate${data.count === 1 ? '' : 's'} (a charge imported twice — e.g. a pending charge that later posted). Uncheck any that are legitimate, then remove the rest.${dupWarning}`
      );
      if (data.error) setAuditMsg((m) => `${m || ''} (${data.error})`.trim());
    } catch (err) {
      setAuditMsg(err.message);
    } finally {
      setAuditBusy(false);
    }
  }

  // Remove only the checked rows.
  async function removeSelected() {
    const ids = [...auditSelected];
    if (ids.length === 0) return;
    setAuditBusy(true);
    setAuditMsg(null);
    try {
      const res = await fetch('/api/plaid/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Remove failed.');
      // Drop the removed rows from the list; anything left was unchecked (kept).
      const removedSet = new Set(ids);
      setAuditFound((prev) => (prev || []).filter((t) => !removedSet.has(t.id)));
      setAuditSelected(new Set());
      setAuditMsg(`Removed ${data.count} duplicate${data.count === 1 ? '' : 's'}. ✓`);
    } catch (err) {
      setAuditMsg(err.message);
    } finally {
      setAuditBusy(false);
    }
  }

  function toggleAuditRow(id) {
    setAuditSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const accounts = budgetState.accounts || [];
  // Full net worth: accounts (Plaid + manual) plus properties and other assets,
  // minus liabilities and property liens.
  const nw = computeNetWorth(budgetState);
  const total = nw.total;
  const assetsTotal = nw.assets;
  const liabilitiesTotal = nw.liabilities;
  const accountsTotal = accounts.reduce((sum, a) => sum + signedBalance(a), 0);
  const properties = budgetState.netWorth?.properties || [];
  const otherAssets = budgetState.netWorth?.otherAssets || [];

  // Mutate the netWorth sub-object without touching envelopes/schedule.
  function updateNetWorth(patch) {
    setBudgetState((prev) => ({ ...prev, netWorth: { ...(prev.netWorth || {}), ...patch } }));
  }
  function addProperty() {
    updateNetWorth({ properties: [...properties, { id: `prop-${Date.now()}`, name: '', address: '', value: '', lien: '' }] });
  }
  function updateProperty(id, patch) {
    updateNetWorth({ properties: properties.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }
  function removeProperty(id) {
    updateNetWorth({ properties: properties.filter((p) => p.id !== id) });
  }
  function addOtherAsset() {
    updateNetWorth({ otherAssets: [...otherAssets, { id: `asset-${Date.now()}`, name: '', value: '' }] });
  }
  function updateOtherAsset(id, patch) {
    updateNetWorth({ otherAssets: otherAssets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function removeOtherAsset(id) {
    updateNetWorth({ otherAssets: otherAssets.filter((a) => a.id !== id) });
  }

  // Everyday credit card cycle settings (see Overview reminder).
  const cc = budgetState.settings?.creditCard || { accountId: '', statementDay: '', dueDay: '' };
  function setCard(field, value) {
    setBudgetState((prev) => ({
      ...prev,
      settings: { ...(prev.settings || {}), creditCard: { ...(prev.settings?.creditCard || {}), [field]: value } },
    }));
  }

  function updateAccount(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }

  function deleteAccount(id) {
    setBudgetState((prev) => ({ ...prev, accounts: prev.accounts.filter((a) => a.id !== id) }));
  }

  // Reorder accounts; this order is what the Overview list and the sidebar
  // quickview follow, since both render the accounts array as-is.
  function moveAccount(id, dir) {
    setBudgetState((prev) => {
      const list = [...(prev.accounts || [])];
      const idx = list.findIndex((a) => a.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= list.length) return prev;
      [list[idx], list[swap]] = [list[swap], list[idx]];
      return { ...prev, accounts: list };
    });
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
      // A partial failure still returns 200 — surface which bank needs attention.
      if (data.error) {
        setSyncMsg(data.error);
      } else {
        const totalSynced = Object.values(data.results || {}).reduce((s, r) => s + (r?.synced || 0), 0);
        setSyncMsg(totalSynced > 0 ? `Synced ${totalSynced} transaction${totalSynced === 1 ? '' : 's'}.` : 'Up to date — no new transactions.');
      }
      reloadBanks();
    } catch (err) {
      setSyncMsg(err.message);
    } finally {
      setSyncingId(null);
    }
  }

  async function removeBank(bank) {
    if (!window.confirm(`Disconnect ${bank.institutionName || 'this bank'}? This removes its accounts and imported transactions. Your envelopes and manual entries are kept.`)) {
      return;
    }
    setSyncingId(bank.itemId);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/plaid/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: bank.itemId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Disconnect failed.');
      setSyncMsg(`${bank.institutionName || 'Bank'} disconnected.`);
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
                  {Array.isArray(b.accounts) && b.accounts.length > 0 && (
                    <span className="bank-accounts">
                      {b.accounts.map((a) => `${a.label}${a.mask ? ` ••${a.mask}` : ''}`).join(' · ')}
                    </span>
                  )}
                  <span className="bank-synced">Last synced {timeAgo(b.lastSyncedAt)}</span>
                  {b.lastError && TRANSIENT_ERROR_CODES.has(b.lastErrorCode) && (
                    <span className="bank-synced">
                      ⏳ Still importing — the bank’s data is settling. This retries on its own;
                      you can also tap <strong>Sync now</strong> again in a little while.
                    </span>
                  )}
                  {b.lastError && !TRANSIENT_ERROR_CODES.has(b.lastErrorCode) && (
                    <span className="bank-error">
                      ⚠ {b.lastError} Tap <strong>Reconnect</strong> to fix it — your imported
                      transactions are kept.
                    </span>
                  )}
                </div>
                <div className="bank-row-actions">
                  {b.lastError && !TRANSIENT_ERROR_CODES.has(b.lastErrorCode) && (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => startPlaid(b.itemId)}
                      disabled={plaidBusy || syncingId !== null}
                    >
                      {plaidBusy ? 'Working…' : 'Reconnect'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => syncBank(b.itemId)}
                    disabled={syncingId !== null}
                  >
                    {syncingId === b.itemId ? 'Working…' : 'Sync now'}
                  </button>
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => removeBank(b)}
                    disabled={syncingId !== null}
                  >
                    Disconnect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="bank-actions">
          <div className="plaid-connect">
            <button type="button" className="primary-btn" onClick={() => startPlaid()} disabled={plaidBusy}>
              {plaidBusy ? 'Working…' : banks.length > 0 ? 'Connect another bank' : 'Connect a bank'}
            </button>
            {plaidError && <span className="module-note form-error">{plaidError}</span>}
          </div>
          {syncMsg && <span className="module-note ai-status">{syncMsg}</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Everyday credit card</h2>
        </div>
        <p className="module-note">
          Pick the card you put everyday spending on, and set its statement and payment-due days. The Overview page
          will then show a reminder as the due date approaches, plus the current balance to pay off.
        </p>
        <div className="cc-config">
          <label className="cc-field">
            <span>Card</span>
            <select value={cc.accountId} onChange={(e) => setCard('accountId', e.target.value)}>
              <option value="">— none —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="cc-field">
            <span>Statement closes (day)</span>
            <input
              type="number"
              min="1"
              max="31"
              inputMode="numeric"
              placeholder="e.g. 18"
              value={cc.statementDay ?? ''}
              onChange={(e) => setCard('statementDay', e.target.value)}
            />
          </label>
          <label className="cc-field">
            <span>Payment due (day)</span>
            <input
              type="number"
              min="1"
              max="31"
              inputMode="numeric"
              placeholder="e.g. 25"
              value={cc.dueDay ?? ''}
              onChange={(e) => setCard('dueDay', e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Transaction audit</h2>
          {Array.isArray(auditFound) && auditFound.length > 0 && (
            <span className="pill pill-warn">{auditFound.length} to remove</span>
          )}
        </div>
        <p className="module-note">
          Checks every imported transaction against your bank’s live feed and finds any the bank no longer
          has — usually an old “pending” charge that already posted under a new entry, leaving a duplicate.
          Nothing is deleted until you review the list and confirm. Your manual entries, receipts, and splits
          are never touched.
        </p>
        <div className="ai-actions">
          <button type="button" className="secondary-btn" onClick={previewAudit} disabled={auditBusy}>
            {auditBusy ? 'Auditing…' : '🔍 Audit for duplicates'}
          </button>
          {Array.isArray(auditFound) && auditFound.length > 0 && (
            <button
              type="button"
              className="primary-btn"
              onClick={removeSelected}
              disabled={auditBusy || auditSelected.size === 0}
            >
              Remove {auditSelected.size} selected
            </button>
          )}
          {auditMsg && <span className="module-note ai-status">{auditMsg}</span>}
        </div>
        {Array.isArray(auditFound) && auditFound.length > 0 && (
          <>
            <div className="audit-select-all">
              <button
                type="button"
                className="link-btn"
                onClick={() => setAuditSelected(new Set(auditFound.map((t) => t.id)))}
              >
                Select all
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className="link-btn" onClick={() => setAuditSelected(new Set())}>
                Select none
              </button>
            </div>
            <ul className="audit-list">
              {auditFound.map((t) => (
                <li key={t.id} className="audit-row">
                  <label className="audit-check">
                    <input
                      type="checkbox"
                      checked={auditSelected.has(t.id)}
                      onChange={() => toggleAuditRow(t.id)}
                    />
                  </label>
                  <span className="audit-date">{(t.date || '').slice(5)}</span>
                  <span className="audit-desc">{t.description}</span>
                  <span className={`audit-amount ${Number(t.amount) < 0 ? 'good' : ''}`}>
                    {Number(t.amount) < 0 ? '+' : '-'}${Math.abs(Number(t.amount)).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Email receipts</h2>
          {emailAccounts.length > 0 && <span className="pill pill-good">{emailAccounts.length} connected</span>}
        </div>
        <p className="module-note">
          Connect the Gmail accounts where your receipts land. Then, on a mystery charge, hit
          <strong> 🔎 Details</strong> and the AI finds the matching receipt and fills in what it was for.
        </p>

        {emailAccounts.length > 0 && (
          <ul className="bank-list">
            {emailAccounts.map((a) => (
              <li key={a.email} className="bank-row">
                <div className="bank-info">
                  <span className="bank-name">{a.email}</span>
                  {!a.searchable && <span className="bank-synced">reconnect needed</span>}
                </div>
                <button type="button" className="link-btn danger" onClick={() => disconnectGmail(a.email)}>
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="bank-actions">
          <button type="button" className="primary-btn" onClick={startGmailConnect}>
            {emailAccounts.length > 0 ? 'Connect another Gmail' : 'Connect a Gmail account'}
          </button>
          {emailMsg && <span className="module-note ai-status">{emailMsg}</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Budgeting style</h2>
        </div>
        <p className="module-note">
          How do you pay for things? Either way the envelopes track your spending — Option 2 adds a
          credit-card payoff safety check on the Overview.
        </p>
        <div className="paymode-options">
          <label className="paymode-option">
            <input
              type="radio"
              name="paymode"
              checked={(budgetState.settings?.payMode || 'checking') === 'checking'}
              onChange={() =>
                setBudgetState((prev) => ({ ...prev, settings: { ...(prev.settings || {}), payMode: 'checking' } }))
              }
            />
            <span>
              <strong>Option 1 — Pay from checking.</strong> Income lands in checking; bills are paid from it directly.
            </span>
          </label>
          <label className="paymode-option">
            <input
              type="radio"
              name="paymode"
              checked={budgetState.settings?.payMode === 'card'}
              onChange={() =>
                setBudgetState((prev) => ({ ...prev, settings: { ...(prev.settings || {}), payMode: 'card' } }))
              }
            />
            <span>
              <strong>Option 2 — Put expenses on a credit card</strong> (for points), pay it off monthly from checking.
              Link the card below and set its type to <em>credit</em>.
            </span>
          </label>
        </div>
      </section>

      <section className="card networth-card">
        <div className="card-header">
          <h2>Net worth</h2>
          <span className={`pill ${total < 0 ? 'pill-bad' : 'pill-good'}`}>{money(total)}</span>
        </div>
        <div className="networth-grid">
          <div className="networth-fig">
            <span className="networth-label">Assets</span>
            <span className="networth-value good">{money(assetsTotal)}</span>
          </div>
          <span className="networth-op">−</span>
          <div className="networth-fig">
            <span className="networth-label">Liabilities</span>
            <span className="networth-value bad">{money(liabilitiesTotal)}</span>
          </div>
          <span className="networth-op">=</span>
          <div className="networth-fig">
            <span className="networth-label">Net worth</span>
            <span className={`networth-value ${total < 0 ? 'bad' : ''}`}>{money(total)}</span>
          </div>
        </div>
        <p className="module-note">
          Combines your linked &amp; manual account balances (checking, savings, investments, cards, loans) with the
          properties and other assets below. Bank, card, and investment balances refresh automatically; property and
          asset values you set here. This total feeds the Net worth card and trend on the Overview.
        </p>
        {(properties.length > 0 || otherAssets.length > 0) && (
          <ul className="networth-breakdown">
            <li><span>Accounts (assets)</span><span className="good">{money(nw.acctAssets)}</span></li>
            <li><span>Accounts (liabilities)</span><span className="bad">−{money(nw.acctLiabilities)}</span></li>
            {properties.length > 0 && <li><span>Property equity</span><span>{money(nw.propertyEquity)}</span></li>}
            {otherAssets.length > 0 && <li><span>Other assets</span><span>{money(nw.otherAssetsValue)}</span></li>}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Property &amp; real estate</h2>
          {properties.length > 0 && <span className="pill">{money(nw.propertyEquity)} equity</span>}
        </div>
        <p className="module-note">
          Add each property with your best estimate of its value (e.g. a Zillow &ldquo;Zestimate&rdquo;) and the
          remaining mortgage / lien. Equity (value − lien) counts toward your net worth. Update the value whenever you
          like.
        </p>
        <div className="asset-editor">
          {properties.map((p) => (
            <div className="asset-row property-row" key={p.id}>
              <input type="text" placeholder="Name (e.g. Home, Rental #1)" value={p.name || ''} onChange={(e) => updateProperty(p.id, { name: e.target.value })} />
              <input type="text" placeholder="Address" value={p.address || ''} onChange={(e) => updateProperty(p.id, { address: e.target.value })} />
              <label className="asset-field">
                <span>Value</span>
                <input type="number" inputMode="decimal" placeholder="0" value={p.value ?? ''} onChange={(e) => updateProperty(p.id, { value: e.target.value })} />
              </label>
              <label className="asset-field">
                <span>Mortgage / lien</span>
                <input type="number" inputMode="decimal" placeholder="0" value={p.lien ?? ''} onChange={(e) => updateProperty(p.id, { lien: e.target.value })} />
              </label>
              <span className="asset-equity" title="Value minus lien">{money(propertyEquity(p))}</span>
              <button type="button" className="link-btn danger" onClick={() => removeProperty(p.id)} aria-label="Remove property">✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="secondary-btn" onClick={addProperty}>+ Add property</button>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Other assets</h2>
          {otherAssets.length > 0 && <span className="pill">{money(nw.otherAssetsValue)}</span>}
        </div>
        <p className="module-note">
          Vehicles, valuables, or anything else you own that isn&apos;t a linked account. Enter your best estimate;
          update it whenever.
        </p>
        <div className="asset-editor">
          {otherAssets.map((a) => (
            <div className="asset-row" key={a.id}>
              <input type="text" placeholder="Name (e.g. 2019 Truck)" value={a.name || ''} onChange={(e) => updateOtherAsset(a.id, { name: e.target.value })} />
              <label className="asset-field">
                <span>Value</span>
                <input type="number" inputMode="decimal" placeholder="0" value={a.value ?? ''} onChange={(e) => updateOtherAsset(a.id, { value: e.target.value })} />
              </label>
              <button type="button" className="link-btn danger" onClick={() => removeOtherAsset(a.id)} aria-label="Remove asset">✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="secondary-btn" onClick={addOtherAsset}>+ Add asset</button>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Your accounts</h2>
          <span className="pill">{money(accountsTotal)} total</span>
        </div>

        <div className="accounts-editor">
          {accounts.map((a, i) => (
            <div className="accounts-editor-row" key={a.id}>
              <div className="account-reorder">
                <button
                  type="button"
                  className="reorder-btn"
                  aria-label={`Move ${a.name} up`}
                  disabled={i === 0}
                  onClick={() => moveAccount(a.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="reorder-btn"
                  aria-label={`Move ${a.name} down`}
                  disabled={i === accounts.length - 1}
                  onClick={() => moveAccount(a.id, 1)}
                >
                  ↓
                </button>
              </div>
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
                    {TYPE_LABEL[t] || t}
                  </option>
                ))}
              </select>
              <span className="accounts-editor-balance" title={isLiability(a) ? 'Amount owed — counts against net worth' : undefined}>
                {isLiability(a) ? '−$' : '$'}
                <input
                  type="number"
                  className="budget-input"
                  value={a.balance}
                  onChange={(e) => updateAccount(a.id, { balance: e.target.value })}
                />
              </span>
              <span className="account-toggles" style={{ display: 'inline-flex', gap: '12px', alignItems: 'center' }}>
                {(a.type === 'checking' || a.type === 'savings') ? (
                  <label className="account-cash-toggle" title="Count this account toward Cash on Hand on the Envelopes page">
                    <input
                      type="checkbox"
                      checked={includeInCashOnHand(a)}
                      onChange={(e) => updateAccount(a.id, { includeInCash: e.target.checked })}
                    />
                    Cash
                  </label>
                ) : (
                  <span className="account-cash-toggle account-cash-na" aria-hidden="true" />
                )}
                {['checking', 'savings', 'credit', 'investing'].includes(a.type) && (
                  <label className="account-cash-toggle" title="Keep this account's balance updated, but don't import its individual transactions (e.g. savings)">
                    <input
                      type="checkbox"
                      checked={!!a.balanceOnly}
                      onChange={(e) => updateAccount(a.id, { balanceOnly: e.target.checked })}
                    />
                    No txns
                  </label>
                )}
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
            {TYPE_LABEL[t] || t}
          </option>
        ))}
      </select>
      <input type="number" placeholder={LIABILITY_TYPES.includes(type) ? 'Amount owed' : 'Balance / value'} value={balance} onChange={(e) => setBalance(e.target.value)} />
      <button type="submit" className="primary-btn">
        Add
      </button>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
