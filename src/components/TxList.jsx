import { useState, useRef } from 'react';
import { findReceipt } from '../lib/findReceipt';
import { uploadReceipt, getReceiptUrl } from '../lib/receiptsClient';
import { TAX_CATEGORIES, taxLabel } from '../lib/tax';

function TxRow({ t, categories, onRecategorize, onToggleExcluded, onSetTaxCategory, taxLabels, showReceiptLookup }) {
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

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

  return (
    <div className={`tx-row${isBiz ? ' tx-row-business' : ''}`}>
      <span className="tx-date">{t.date.slice(5)}</span>
      <span className="tx-desc">
        {t.description}
        {t.source === 'plaid' && <span className="pill tx-source-pill">Synced</span>}
        {isBiz && <span className="pill tx-biz-pill">Business</span>}
        {t.taxCategory && !isBiz && <span className="pill tx-tax-pill">{taxLabel(t.taxCategory, taxLabels)}</span>}
        {t.note && <span className="tx-note">{t.note}</span>}
        {lookupMsg && <span className="tx-lookup-msg">{lookupMsg}</span>}
      </span>
      <span className={`tx-amount ${t.amount < 0 ? 'good' : ''}`}>
        {t.amount < 0 ? '+' : '-'}${Math.abs(Number(t.amount)).toFixed(2)}
      </span>
      <select value={t.categoryId || ''} onChange={(e) => onRecategorize(t.id, e.target.value)}>
        {!t.categoryId && (
          <option value="" disabled>
            Uncategorized (income)
          </option>
        )}
        {categories.map((c) => (
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
  );
}

// Splits any transaction list into what's actually active vs. what's been
// marked Ignored, so ignored transactions drop into their own collapsed
// "N ignored" drawer instead of cluttering the main list they came from.
export default function TxList({
  transactions,
  categories,
  onRecategorize,
  onToggleExcluded,
  onSetTaxCategory,
  taxLabels,
  showReceiptLookup = false,
  emptyLabel = 'Nothing here yet.',
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const active = transactions.filter((t) => !t.excluded);
  const ignored = transactions.filter((t) => t.excluded);

  const rowProps = { categories, onRecategorize, onToggleExcluded, onSetTaxCategory, taxLabels, showReceiptLookup };

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
