import { useState, useRef } from 'react';
import { findReceipt } from '../lib/findReceipt';
import { uploadReceipt, getReceiptUrl } from '../lib/receiptsClient';
import { TAX_CATEGORIES, taxLabel } from '../lib/tax';

function TxRow({ t, categories, incomeCategories = [], onRecategorize, onSplit, onToggleExcluded, onSetTaxCategory, taxLabels, showReceiptLookup }) {
  // Money coming in (negative amount = deposit) gets income labels; money going
  // out gets the budget envelopes.
  const isIncome = Number(t.amount) < 0;
  const options = isIncome && incomeCategories.length > 0 ? incomeCategories : categories;
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [parts, setParts] = useState([]);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitMsg, setSplitMsg] = useState(null);
  const fileRef = useRef(null);

  const total = Math.abs(Number(t.amount));
  const partsSum = parts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remainder = total - partsSum;

  function openSplit() {
    setSplitMsg(null);
    setParts([
      { categoryId: t.categoryId && options.some((c) => c.id === t.categoryId) ? t.categoryId : '', amount: '' },
      { categoryId: '', amount: '' },
    ]);
    setShowSplit(true);
  }
  function updatePart(i, patch) {
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPart() {
    setParts((prev) => [...prev, { categoryId: '', amount: '' }]);
  }
  function removePart(i) {
    setParts((prev) => prev.filter((_, idx) => idx !== i));
  }
  async function saveSplit() {
    const cleaned = parts
      .map((p) => ({ categoryId: p.categoryId, amount: Number(p.amount) }))
      .filter((p) => p.amount > 0);
    if (cleaned.length < 2) {
      setSplitMsg('Add at least two lines with an amount.');
      return;
    }
    if (cleaned.some((p) => !p.categoryId)) {
      setSplitMsg('Pick an envelope for every line.');
      return;
    }
    const sum = cleaned.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(sum - total) > 0.01) {
      setSplitMsg(`Lines must add up to $${total.toFixed(2)} (they total $${sum.toFixed(2)}).`);
      return;
    }
    const sign = Number(t.amount) < 0 ? -1 : 1;
    setSplitBusy(true);
    setSplitMsg(null);
    const err = await onSplit(t, cleaned.map((p) => ({ categoryId: p.categoryId, amount: sign * p.amount })));
    setSplitBusy(false);
    if (err) setSplitMsg(err.message || 'Could not split this transaction.');
    else setShowSplit(false);
  }

  async function lookUp() {
    setLookupBusy(true);
    setLookupMsg(null);
    try {
      const data = await findReceipt(t.id);
      setLookupMsg(data.found ? `Found: ${data.detail}` : 'No matching receipt found in your connected inboxes.');
    } catch (err) {
      setLookupMsg(err.message);
    } finally {
      setLookupBusy(false);
    }
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setLookupMsg(null);
    try {
      await uploadReceipt(t.id, file);
      setLookupMsg('Receipt attached.');
    } catch (err) {
      setLookupMsg(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function viewReceipt() {
    try {
      const url = await getReceiptUrl(t.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setLookupMsg(err.message);
    }
  }

  const isBiz = t.business || t.taxCategory === 'business-1' || t.taxCategory === 'business-2';
  const canSplit = onSplit && t.source !== 'split' && !t.excluded;

  return (
    <>
    <div className={`tx-row${isBiz ? ' tx-row-business' : ''}`}>
      <span className="tx-date">{(t.date || '').slice(5)}</span>
      <span className="tx-desc">
        {t.description}
        {t.source === 'plaid' && <span className="pill tx-source-pill">Synced</span>}
        {t.source === 'receipt' && <span className="pill tx-receipt-pill">Receipt</span>}
        {isBiz && <span className="pill tx-biz-pill">Business</span>}
        {t.taxCategory && !isBiz && <span className="pill tx-tax-pill">{taxLabel(t.taxCategory, taxLabels)}</span>}
        {t.note && <span className="tx-note">{t.note}</span>}
        {lookupMsg && <span className="tx-lookup-msg">{lookupMsg}</span>}
      </span>
      <span className={`tx-amount ${t.amount < 0 ? 'good' : ''}`}>
        {t.amount < 0 ? '+' : '-'}${Math.abs(Number(t.amount)).toFixed(2)}
      </span>
      <select value={t.categoryId || ''} onChange={(e) => onRecategorize(t.id, e.target.value)}>
        {!options.some((c) => c.id === t.categoryId) && (
          <option value="" disabled>
            {isIncome ? 'Uncategorized (income)' : 'Uncategorized'}
          </option>
        )}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="tx-actions">
        {onSetTaxCategory && (
          <select
            className="tx-tax-select"
            value={t.taxCategory || ''}
            onChange={(e) => onSetTaxCategory(t.id, e.target.value)}
            title="Tag for the CPA tax report (and exclude business from the household budget)"
          >
            <option value="">Tax: —</option>
            {TAX_CATEGORIES.map((k) => (
              <option key={k} value={k}>
                {taxLabel(k, taxLabels)}
              </option>
            ))}
          </select>
        )}
        {showReceiptLookup && (
          <button type="button" className="tx-tag-btn" onClick={lookUp} disabled={lookupBusy} title="Search your connected email for this receipt">
            {lookupBusy ? '…' : '🔎'}
          </button>
        )}
        {t.receiptPath ? (
          <button type="button" className="tx-tag-btn active" onClick={viewReceipt} title="View attached receipt">
            📎 View
          </button>
        ) : (
          <button type="button" className="tx-tag-btn" onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach a receipt photo/PDF">
            {uploading ? '…' : '📎'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onPickFile} />
        {canSplit && (
          <button
            type="button"
            className={`tx-tag-btn${showSplit ? ' active' : ''}`}
            title="Split this transaction across multiple envelopes"
            onClick={() => (showSplit ? setShowSplit(false) : openSplit())}
          >
            ✂ Split
          </button>
        )}
        <button
          type="button"
          className="tx-tag-btn"
          title="Exclude this transaction from category spending totals without deleting it"
          onClick={() => onToggleExcluded(t.id, !t.excluded)}
        >
          {t.excluded ? 'Include' : 'Ignore'}
        </button>
      </div>
    </div>

    {showSplit && (
      <div className="tx-split">
        <div className="tx-split-head">
          Split <strong>${total.toFixed(2)}</strong> across envelopes
        </div>
        {parts.map((p, i) => (
          <div className="tx-split-row" key={i}>
            <select value={p.categoryId} onChange={(e) => updatePart(i, { categoryId: e.target.value })}>
              <option value="" disabled>
                Choose envelope…
              </option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="tx-split-amt">
              $
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={p.amount}
                onChange={(e) => updatePart(i, { amount: e.target.value })}
              />
            </span>
            {parts.length > 2 && (
              <button type="button" className="link-btn danger" onClick={() => removePart(i)} aria-label="Remove line">
                ✕
              </button>
            )}
          </div>
        ))}
        <div className="tx-split-foot">
          <button type="button" className="link-btn" onClick={addPart}>
            + Add line
          </button>
          <span className={`tx-split-remainder ${Math.abs(remainder) < 0.01 ? 'good' : 'bad'}`}>
            {remainder >= 0 ? `Remaining: $${remainder.toFixed(2)}` : `Over by $${Math.abs(remainder).toFixed(2)}`}
          </span>
        </div>
        {splitMsg && <span className="module-note form-error">{splitMsg}</span>}
        <div className="tx-split-foot">
          <button type="button" className="primary-btn" onClick={saveSplit} disabled={splitBusy}>
            {splitBusy ? 'Saving…' : 'Save split'}
          </button>
          <button type="button" className="link-btn" onClick={() => setShowSplit(false)}>
            Cancel
          </button>
        </div>
      </div>
    )}
    </>
  );
}

// Splits any transaction list into what's actually active vs. what's been
// marked Ignored, so ignored transactions drop into their own collapsed
// "N ignored" drawer instead of cluttering the main list they came from.
export default function TxList({
  transactions,
  categories,
  incomeCategories = [],
  onRecategorize,
  onSplit,
  onToggleExcluded,
  onSetTaxCategory,
  taxLabels,
  showReceiptLookup = false,
  emptyLabel = 'Nothing here yet.',
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const active = transactions.filter((t) => !t.excluded);
  const ignored = transactions.filter((t) => t.excluded);

  const rowProps = { categories, incomeCategories, onRecategorize, onSplit, onToggleExcluded, onSetTaxCategory, taxLabels, showReceiptLookup };

  if (active.length === 0 && ignored.length === 0) {
    return <p className="module-note">{emptyLabel}</p>;
  }

  return (
    <>
      {active.length > 0 ? (
        <div className="tx-table">
          {active.map((t) => (
            <TxRow key={t.id} t={t} {...rowProps} />
          ))}
        </div>
      ) : (
        <p className="module-note">Everything here is currently ignored.</p>
      )}

      {ignored.length > 0 && (
        <div className="tx-ignored-drawer">
          <button type="button" className="category-expand-toggle" onClick={() => setShowIgnored((v) => !v)}>
            {showIgnored ? 'Hide' : 'Show'} {ignored.length} ignored {showIgnored ? '▴' : '▾'}
          </button>
          {showIgnored && (
            <div className="tx-table category-tx-table">
              {ignored.map((t) => (
                <TxRow key={t.id} t={t} {...rowProps} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
