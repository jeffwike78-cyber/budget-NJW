import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory } from '../lib/spending';
import BarChart from '../components/BarChart';
import Analysis from './Analysis';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const usd2 = (n) => `$${Math.abs(Number(n || 0)).toFixed(2)}`;

function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}
function monthLabel(m) {
  return new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function shortMonthLabel(m) {
  return new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
}

// Money that actually landed as income this period: deposits (negative in this
// app's convention) that aren't excluded transfers/card payments or business.
function incomeOf(txns) {
  return txns
    .filter((t) => Number(t.amount) < 0 && !t.excluded && !t.business)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
}
function expensesOf(txns) {
  return Object.values(netSpentByCategory(txns)).reduce((a, b) => a + b, 0);
}

export default function Summary({ budgetState, setBudgetState, transactions }) {
  const [mode, setMode] = useState('month'); // 'month' | 'year' | 'insights'
  const current = monthKey();
  const currentYear = current.slice(0, 4);

  // Which months/years actually have data, newest first, always including the
  // current one so a fresh month is selectable.
  const monthsWithData = [...new Set([current, ...transactions.map((t) => (t.date || '').slice(0, 7)).filter(Boolean)])]
    .sort()
    .reverse();
  const yearsWithData = [...new Set([currentYear, ...transactions.map((t) => (t.date || '').slice(0, 4)).filter(Boolean)])]
    .sort()
    .reverse();

  const [selMonth, setSelMonth] = useState(current);
  const [selYear, setSelYear] = useState(currentYear);
  const [openCat, setOpenCat] = useState(null);

  const catName = (id) => {
    if (!id || id === 'needs-review') return 'Needs review / uncategorized';
    const c = (budgetState.categories || []).find((x) => x.id === id);
    return c?.name || 'Uncategorized';
  };

  // ---- Category breakdown for a set of transactions ----
  function categoryRows(txns) {
    const totals = netSpentByCategory(txns);
    const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(totals)
      .map(([id, amount]) => ({ id, name: catName(id), amount, pct: (amount / total) * 100 }))
      .filter((r) => r.amount > 0.005)
      .sort((a, b) => b.amount - a.amount);
  }

  return (
    <>
      <h1 className="page-title">Summary</h1>
      <p className="page-intro no-print">
        A plain profit-and-loss view of your money: what came in, what went out, and where it went. Switch between a
        single month and a full year to spot patterns and learn from them. Built from every transaction on record.
      </p>

      <section className="card no-print">
        <div className="summary-controls">
          <div className="summary-mode" role="tablist" aria-label="Summary period">
            <button type="button" role="tab" aria-selected={mode === 'month'} className={`summary-mode-btn${mode === 'month' ? ' active' : ''}`} onClick={() => setMode('month')}>
              Month
            </button>
            <button type="button" role="tab" aria-selected={mode === 'year'} className={`summary-mode-btn${mode === 'year' ? ' active' : ''}`} onClick={() => setMode('year')}>
              Year
            </button>
            <button type="button" role="tab" aria-selected={mode === 'insights'} className={`summary-mode-btn${mode === 'insights' ? ' active' : ''}`} onClick={() => setMode('insights')}>
              Insights
            </button>
          </div>
          {mode === 'month' && (
            <label className="analysis-month">
              <span>Month</span>
              <select value={selMonth} onChange={(e) => { setSelMonth(e.target.value); setOpenCat(null); }}>
                {monthsWithData.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            </label>
          )}
          {mode === 'year' && (
            <label className="analysis-month">
              <span>Year</span>
              <select value={selYear} onChange={(e) => { setSelYear(e.target.value); setOpenCat(null); }}>
                {yearsWithData.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
          {mode !== 'insights' && (
            <button type="button" className="secondary-btn" onClick={() => window.print()}>🖨 Print / Save PDF</button>
          )}
        </div>
      </section>

      {mode === 'insights' ? (
        <Analysis budgetState={budgetState} setBudgetState={setBudgetState} transactions={transactions} embedded />
      ) : mode === 'month' ? (
        <MonthPnl />
      ) : (
        <YearReview />
      )}
    </>
  );

  // ---------- Month P&L ----------
  function MonthPnl() {
    const monthTx = transactions.filter((t) => (t.date || '').slice(0, 7) === selMonth);
    const income = incomeOf(monthTx);
    const expenses = expensesOf(monthTx);
    const net = income - expenses;
    const rows = categoryRows(monthTx);

    return (
      <>
        <section className={`card summary-pnl ${net >= 0 ? 'summary-pos' : 'summary-neg'}`}>
          <div className="card-header">
            <h2>{monthLabel(selMonth)}</h2>
            <span className={`pill ${net >= 0 ? 'pill-good' : 'pill-bad'}`}>
              {net >= 0 ? `${usd(net)} surplus` : `${usd(-net)} over`}
            </span>
          </div>
          <div className="pnl-figures">
            <div className="pnl-figure">
              <span className="pnl-label">Money in</span>
              <span className="pnl-value good">{usd(income)}</span>
            </div>
            <div className="pnl-figure">
              <span className="pnl-label">Money out</span>
              <span className="pnl-value">{usd(expenses)}</span>
            </div>
            <div className="pnl-figure">
              <span className="pnl-label">Net</span>
              <span className={`pnl-value ${net >= 0 ? 'good' : 'bad'}`}>{net >= 0 ? usd(net) : `-${usd(-net)}`}</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Where it went</h2>
            {rows.length > 0 && <span className="pill">{rows.length} categories</span>}
          </div>
          {rows.length === 0 ? (
            <p className="module-note">No spending recorded for {monthLabel(selMonth)}.</p>
          ) : (
            <ul className="pnl-cat-list">
              {rows.map((r) => (
                <li key={r.id} className="pnl-cat">
                  <button type="button" className="pnl-cat-head" onClick={() => setOpenCat(openCat === r.id ? null : r.id)} aria-expanded={openCat === r.id}>
                    <span className="pnl-cat-name">{r.name}</span>
                    <span className="pnl-cat-amount">{usd(r.amount)}</span>
                    <span className="pnl-cat-pct">{r.pct.toFixed(0)}%</span>
                    <span className="pnl-cat-caret">{openCat === r.id ? '▴' : '▾'}</span>
                  </button>
                  <div className="pnl-cat-bar"><span style={{ width: `${Math.min(100, r.pct)}%` }} /></div>
                  {openCat === r.id && (
                    <ul className="pnl-tx-list">
                      {monthTx
                        .filter((t) => t.categoryId === r.id && !t.excluded && Number(t.amount) > 0)
                        .sort((a, b) => Number(b.amount) - Number(a.amount))
                        .map((t) => (
                          <li key={t.id} className="pnl-tx">
                            <span className="pnl-tx-date">{(t.date || '').slice(5)}</span>
                            <span className="pnl-tx-desc">{t.description}</span>
                            <span className="pnl-tx-amt">{usd2(t.amount)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  // ---------- Year review ----------
  function YearReview() {
    const yearTx = transactions.filter((t) => (t.date || '').slice(0, 4) === selYear);
    const months = Array.from({ length: 12 }, (_, i) => `${selYear}-${String(i + 1).padStart(2, '0')}`);
    const perMonth = months.map((m) => {
      const tx = transactions.filter((t) => (t.date || '').slice(0, 7) === m);
      return { m, income: incomeOf(tx), expense: expensesOf(tx) };
    });
    const totalIncome = perMonth.reduce((s, x) => s + x.income, 0);
    const totalExpense = perMonth.reduce((s, x) => s + x.expense, 0);
    const net = totalIncome - totalExpense;
    // Average spend over the months that actually have activity.
    const activeMonths = perMonth.filter((x) => x.income > 0 || x.expense > 0).length || 1;
    const avgSpend = totalExpense / activeMonths;
    const chartData = perMonth.map((x) => ({ label: shortMonthLabel(x.m), a: x.income, b: x.expense }));
    const rows = categoryRows(yearTx);

    return (
      <>
        <section className={`card summary-pnl ${net >= 0 ? 'summary-pos' : 'summary-neg'}`}>
          <div className="card-header">
            <h2>{selYear} in review</h2>
            <span className={`pill ${net >= 0 ? 'pill-good' : 'pill-bad'}`}>
              {net >= 0 ? `${usd(net)} saved` : `${usd(-net)} over`}
            </span>
          </div>
          <div className="pnl-figures">
            <div className="pnl-figure">
              <span className="pnl-label">Total in</span>
              <span className="pnl-value good">{usd(totalIncome)}</span>
            </div>
            <div className="pnl-figure">
              <span className="pnl-label">Total out</span>
              <span className="pnl-value">{usd(totalExpense)}</span>
            </div>
            <div className="pnl-figure">
              <span className="pnl-label">Net</span>
              <span className={`pnl-value ${net >= 0 ? 'good' : 'bad'}`}>{net >= 0 ? usd(net) : `-${usd(-net)}`}</span>
            </div>
            <div className="pnl-figure">
              <span className="pnl-label">Avg spend / mo</span>
              <span className="pnl-value">{usd(avgSpend)}</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2>Month by month</h2></div>
          <BarChart data={chartData} aLabel="In" bLabel="Out" />
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Where it went in {selYear}</h2>
            {rows.length > 0 && <span className="pill">{rows.length} categories</span>}
          </div>
          {rows.length === 0 ? (
            <p className="module-note">No spending recorded for {selYear} yet.</p>
          ) : (
            <ul className="pnl-cat-list">
              {rows.map((r) => (
                <li key={r.id} className="pnl-cat">
                  <div className="pnl-cat-head static">
                    <span className="pnl-cat-name">{r.name}</span>
                    <span className="pnl-cat-amount">{usd(r.amount)}</span>
                    <span className="pnl-cat-pct">{r.pct.toFixed(0)}%</span>
                  </div>
                  <div className="pnl-cat-bar"><span style={{ width: `${Math.min(100, r.pct)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }
}
