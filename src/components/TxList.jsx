import { useState } from 'react';

function TxRow({ t, categories, onRecategorize, onToggleExcluded }) {
  return (
    <div className="tx-row">
      <span className="tx-date">{t.date.slice(5)}</span>
      <span className="tx-desc">
        {t.description}
        {t.source === 'plaid' && <span className="pill tx-source-pill">Synced</span>}
      </span>
      <span className={`tx-amount ${t.amount < 0 ? 'good' : ''}`}>
        {t.amount < 0 ? '+' : '-'}${Math.abs(Number(t.amount)).toFixed(2)}
      </span>
      <select value={t.categoryId || ''} onChange={(e) => onRecategorize(t.id, e.target.value)}>
        {/* A null categoryId (income deliberately left uncategorized) has no matching
            option below — without this, the browser silently selects the first real
            category instead, which looks like a lie about what this transaction is. */}
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
      <button
        type="button"
        className="tx-ignore-btn"
        title="Exclude this transaction from category spending totals without deleting it"
        onClick={() => onToggleExcluded(t.id, !t.excluded)}
      >
        {t.excluded ? 'Include' : 'Ignore'}
      </button>
    </div>
  );
}

// Splits any transaction list into what's actually active vs. what's been
// marked Ignored, so ignored transactions drop into their own collapsed
// "N ignored" drawer instead of cluttering the main list they came from.
export default function TxList({ transactions, categories, onRecategorize, onToggleExcluded, emptyLabel = 'Nothing here yet.' }) {
  const [showIgnored, setShowIgnored] = useState(false);
  const active = transactions.filter((t) => !t.excluded);
  const ignored = transactions.filter((t) => t.excluded);

  if (active.length === 0 && ignored.length === 0) {
    return <p className="module-note">{emptyLabel}</p>;
  }

  return (
    <>
      {active.length > 0 ? (
        <div className="tx-table">
          {active.map((t) => (
            <TxRow key={t.id} t={t} categories={categories} onRecategorize={onRecategorize} onToggleExcluded={onToggleExcluded} />
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
                <TxRow key={t.id} t={t} categories={categories} onRecategorize={onRecategorize} onToggleExcluded={onToggleExcluded} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
