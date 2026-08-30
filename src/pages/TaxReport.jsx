import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { getReceiptUrl } from '../lib/receiptsClient';
import { TAX_CATEGORIES, DEFAULT_TAX_LABELS, taxLabel } from '../lib/tax';

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Year-end tax report, grouped by tax bucket (Charitable, Medical, Business 1,
// Business 2) with totals and a CSV export to hand to a CPA.
export default function TaxReport({ budgetState, setBudgetState, transactions, setTaxCategory, setView }) {
  const years = yearsPresent(transactions);
  const [year, setYear] = useState(String(new Date(todayStr()).getFullYear()));
  const labels = { ...DEFAULT_TAX_LABELS, ...(budgetState.taxLabels || {}) };

  const inYear = transactions.filter((t) => !t.excluded && Number(t.amount) > 0 && t.date.startsWith(year));
  const byCategory = {};
  for (const key of TAX_CATEGORIES) {
    byCategory[key] = inYear.filter((t) => t.taxCategory === key).sort((a, b) => a.date.localeCompare(b.date));
  }
  const grandTotal = TAX_CATEGORIES.reduce(
    (sum, key) => sum + byCategory[key].reduce((s, t) => s + Number(t.amount), 0),
    0
  );

  function renameLabel(key, value) {
    setBudgetState((prev) => ({ ...prev, taxLabels: { ...labels, [key]: value } }));
  }

  function exportCsv() {
    const rows = [['Category', 'Date', 'Payee', 'Detail', 'Amount']];
    for (const key of TAX_CATEGORIES) {
      for (const t of byCategory[key]) {
        rows.push([labels[key], t.date, t.description, t.note || '', Number(t.amount).toFixed(2)]);
      }
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-report-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="tax-report">
      <div className="tax-report-head no-print">
        <div>
          {setView && (
            <button type="button" className="link-btn" onClick={() => setView('settings')}>
              ← Settings
            </button>
          )}
          <h1 className="page-title">Tax Report</h1>
        </div>
        <div className="tax-report-controls">
          <label>
            Year
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="primary-btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="print-only tax-print-title">Tax Report — {year}</div>

      <section className="card">
        <div className="card-header">
          <h2>Summary</h2>
          <span className="pill">{money(grandTotal)} total</span>
        </div>
        <table className="tax-table">
          <tbody>
            {TAX_CATEGORIES.map((key) => {
              const subtotal = byCategory[key].reduce((s, t) => s + Number(t.amount), 0);
              return (
                <tr key={key}>
                  <td className="tax-desc">{taxLabel(key, labels)}</td>
                  <td className="tax-amt">{money(subtotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="module-note no-print">
          Tag transactions on the Transactions page using the <strong>Tax</strong> dropdown. (Your Giving
          envelopes aren&apos;t counted here — they&apos;re personal gifts, not deductions.) Rename the
          business buckets below.
        </p>
        <div className="tax-label-editors no-print">
          {['business-1', 'business-2'].map((key) => (
            <label key={key}>
              {DEFAULT_TAX_LABELS[key]} name
              <input value={labels[key]} onChange={(e) => renameLabel(key, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      {TAX_CATEGORIES.map((key) => {
        const rows = byCategory[key];
        if (rows.length === 0) return null;
        const subtotal = rows.reduce((s, t) => s + Number(t.amount), 0);
        return (
          <section className="card" key={key}>
            <div className="card-header">
              <h2>{taxLabel(key, labels)}</h2>
              <span className="pill">{money(subtotal)}</span>
            </div>
            <table className="tax-table">
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="tax-date">{t.date}</td>
                    <td className="tax-desc">
                      {t.description}
                      {t.note && <span className="tax-note"> — {t.note}</span>}
                    </td>
                    <td className="tax-amt">{money(t.amount)}</td>
                    <td className="no-print">
                      {t.receiptPath && (
                        <button type="button" className="link-btn" onClick={() => openReceipt(t.id)}>
                          receipt
                        </button>
                      )}
                    </td>
                    <td className="no-print">
                      <button type="button" className="link-btn danger" onClick={() => setTaxCategory(t.id, '')}>
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

async function openReceipt(transactionId) {
  try {
    const url = await getReceiptUrl(transactionId);
    window.open(url, '_blank', 'noopener');
  } catch {
    // ignore — button just won't open anything
  }
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function yearsPresent(transactions) {
  const set = new Set(transactions.map((t) => t.date.slice(0, 4)));
  set.add(String(new Date(todayStr()).getFullYear()));
  return [...set].sort().reverse();
}
