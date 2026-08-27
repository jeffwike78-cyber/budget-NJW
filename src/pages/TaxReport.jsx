import { useState } from 'react';
import { todayStr } from '../lib/storage';

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Tax report: charitable giving (any envelope in the "Giving" group) plus
// anything you've explicitly flagged tax-deductible, for the chosen year. Hit
// Print for a clean copy for your records.
export default function TaxReport({ budgetState, transactions, setDeductible }) {
  const years = yearsPresent(transactions);
  const [year, setYear] = useState(String(new Date(todayStr()).getFullYear()));

  const categoriesById = Object.fromEntries((budgetState.categories || []).map((c) => [c.id, c]));
  const givingIds = new Set((budgetState.categories || []).filter((c) => c.group === 'Giving').map((c) => c.id));

  const included = transactions.filter((t) => {
    if (t.excluded || t.business) return false;
    if (Number(t.amount) <= 0) return false; // spending only
    if (!t.date.startsWith(year)) return false;
    return t.deductible || givingIds.has(t.categoryId);
  });

  // Group by category (name), each with a subtotal.
  const groups = {};
  for (const t of included) {
    const cat = categoriesById[t.categoryId];
    const label = cat ? cat.name : t.deductible ? 'Other deductible' : 'Uncategorized';
    (groups[label] = groups[label] || []).push(t);
  }
  const groupNames = Object.keys(groups).sort();
  const grandTotal = included.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="tax-report">
      <div className="tax-report-head no-print">
        <h1 className="page-title">Tax Report</h1>
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
          <button type="button" className="primary-btn" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="print-only tax-print-title">Tax Report — {year}</div>

      <section className="card">
        <div className="card-header">
          <h2>Charitable giving &amp; deductible expenses</h2>
          <span className="pill">{money(grandTotal)} total</span>
        </div>
        <p className="module-note no-print">
          Includes every transaction in a <strong>Giving</strong> envelope plus anything you tagged{' '}
          <strong>Tax</strong> on the Transactions page. Use the 🔎 button on a transaction to attach the
          receipt detail, which shows here too.
        </p>

        {included.length === 0 ? (
          <p className="module-note">Nothing tagged for {year} yet.</p>
        ) : (
          groupNames.map((name) => {
            const rows = groups[name];
            const subtotal = rows.reduce((s, t) => s + Number(t.amount), 0);
            return (
              <div className="tax-group" key={name}>
                <div className="tax-group-head">
                  <h3>{name}</h3>
                  <span className="tax-group-total">{money(subtotal)}</span>
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
                        {setDeductible && !givingIds.has(t.categoryId) && (
                          <td className="no-print">
                            <button type="button" className="link-btn danger" onClick={() => setDeductible(t.id, false)}>
                              remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function yearsPresent(transactions) {
  const set = new Set(transactions.map((t) => t.date.slice(0, 4)));
  set.add(String(new Date(todayStr()).getFullYear()));
  return [...set].sort().reverse();
}
