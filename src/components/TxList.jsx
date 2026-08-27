import { useState } from 'react';
import { findReceipt } from '../lib/findReceipt';

function TxRow({ t, categories, onRecategorize, onToggleExcluded, onToggleBusiness, onToggleDeductible, showReceiptLookup }) {
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState(null);

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

  return (
    <div className={`tx-row${t.business ? ' tx-row-business' : ''}`}>
      <span className="tx-date">{t.date.slice(5)}</span>
      <span className="tx-desc">
        {t.description}
        {t.source === 'plaid' && <span className="pill tx-source-pill">Synced</span>}
        {t.business && <span className="pill tx-biz-pill">Business</span>}
        {t.deductible && <span className="pill tx-tax-pill">Tax</span>}
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
        {showReceiptLookup && (
          <button type="button" className="tx-tag-btn" onClick={lookUp} disabled={lookupBusy} title="Search your connected email for this receipt">
            {lookupBusy ? '…' : '🔎'}
          </button>
        )}
        {onToggleBusiness && (
          <button
            type="button"
            className={`tx-tag-btn${t.business ? ' active' : ''}`}
            onClick={() => onToggleBusiness(t.id, !t.business)}
            title="Mark as a business/rental expense — excluded from the household budget"
          >
            Biz
          </button>
        )}
        {onToggleDeductible && (
          <button
            type="button"
            className={`tx-tag-btn${t.deductible ? ' active' : ''}`}
            onClick={() => onToggleDeductible(t.id, !t.deductible)}
            title="Mark as tax-deductible — included in the Tax Report"
          >
            Tax
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
  onToggleBusiness,
  onToggleDeductible,
  showReceiptLookup = false,
  emptyLabel = 'Nothing here yet.',
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const active = transactions.filter((t) => !t.excluded);
  const ignored = transactions.filter((t) => t.excluded);

  const rowProps = { categories, onRecategorize, onToggleExcluded, onToggleBusiness, onToggleDeductible, showReceiptLookup };

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
