import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory, spendingCategoryIds } from '../lib/spending';
import { monthlyIncomeTotal, computeCategoryBudgets, effectiveBudgetsForMonth } from '../lib/budgetMath';
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
function incomeOf(txns, creditIds) {
  return txns
    .filter((t) => Number(t.amount) < 0 && !t.excluded && !t.business && !(creditIds && creditIds.has(t.categoryId)))
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
}
function expensesOf(txns, creditIds) {
  return Object.values(netSpentByCategory(txns, creditIds)).reduce((a, b) => a + b, 0);
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

  // Refunds credited to a spending envelope net against it and aren't income.
  const creditIds = spendingCategoryIds(budgetState);

  const catName = (id) => {
    if (!id || id === 'needs-review') return 'Needs review / uncategorized';
    const c = (budgetState.categories || []).find((x) => x.id === id);
    return c?.name || 'Uncategorized';
  };

  // ---- Category breakdown for a set of transactions ----
  function categoryRows(txns) {
    const totals = netSpentByCategory(txns, creditIds);
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
    const income = incomeOf(monthTx, creditIds);
    const expenses = expensesOf(monthTx, creditIds);
    const net = income - expenses;

    // Budgeted vs actual. Budget plan for this month: the base plan with any
    // per-month overrides applied (same figures the Budget page uses).
    const budgetable = (budgetState.categories || []).filter((c) => c.id !== 'needs-review');
    const planIncome = monthlyIncomeTotal(budgetState);
    const baseBudgets = computeCategoryBudgets(budgetable, planIncome);
    const effBudgets = effectiveBudgetsForMonth(budgetable, baseBudgets, selMonth);
    const spentMap = netSpentByCategory(monthTx, creditIds);

    // One row per category that has a budget or any activity this month. diff =
    // budget − actual: positive is under budget (room left), negative is over.
    // Sort most-over first so the categories to adjust are right at the top.
    const bvaRows = budgetable
      .map((c) => ({ id: c.id, name: c.name, budget: Number(effBudgets[c.id] || 0), actual: Number(spentMap[c.id] || 0) }))
      .filter((r) => r.budget > 0.005 || Math.abs(r.actual) > 0.005)
      .map((r) => ({ ...r, diff: r.budget - r.actual }))
      .sort((a, b) => a.diff - b.diff);

    // Spending that didn't land in a budget category (uncategorized / needs
    // review), so the actual total still reconciles with "Money out".
    const budgetableIds = new Set(budgetable.map((c) => c.id));
    const otherActual = Object.entries(spentMap)
      .filter(([id]) => !budgetableIds.has(id))
      .reduce((s, [, v]) => s + v, 0);

    const totalBudget = bvaRows.reduce((s, r) => s + r.budget, 0);
    const incDiff = income - planIncome; // positive = more income than planned

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

        {/* Income: budgeted vs actual */}
        <section className="card">
          <div className="card-header"><h2>Income — budgeted vs actual</h2></div>
          <div className="bva-row bva-head">
            <span className="bva-name"></span>
            <span className="bva-num">Budgeted</span>
            <span className="bva-num">Actual</span>
            <span className="bva-num">+ / −</span>
          </div>
          <div className="bva-row">
            <span className="bva-name">Income</span>
            <span className="bva-num">{usd(planIncome)}</span>
            <span className="bva-num">{usd(income)}</span>
            <span className={`bva-num ${incDiff >= 0 ? 'good' : 'bad'}`}>
              {incDiff >= 0 ? `+${usd(incDiff)}` : `-${usd(-incDiff)}`}
            </span>
          </div>
          <p className="module-note">
            {incDiff >= 0
              ? `You brought in ${usd(incDiff)} more than planned.`
              : `Income came in ${usd(-incDiff)} short of plan.`}
          </p>
        </section>

        {/* Spending: budgeted vs actual, per category */}
        <section className="card">
          <div className="card-header">
            <h2>Spending — budgeted vs actual</h2>
            {bvaRows.length > 0 && <span className="pill">{bvaRows.length} categories</span>}
          </div>
          {bvaRows.length === 0 ? (
            <p className="module-note">No budget or spending recorded for {monthLabel(selMonth)}.</p>
          ) : (
            <>
              <div className="bva-row bva-head">
                <span className="bva-name">Category</span>
                <span className="bva-num">Budgeted</span>
                <span className="bva-num">Actual</span>
                <span className="bva-num">Over / under</span>
              </div>
              <ul className="bva-list">
                {bvaRows.map((r) => {
                  const over = r.diff < -0.005;
                  const pct = r.budget > 0 ? Math.min(100, (r.actual / r.budget) * 100) : 100;
                  return (
                    <li key={r.id} className="bva-item">
                      <button type="button" className="bva-row bva-click" onClick={() => setOpenCat(openCat === r.id ? null : r.id)} aria-expanded={openCat === r.id}>
                        <span className="bva-name">{r.name} <span className="bva-caret">{openCat === r.id ? '▴' : '▾'}</span></span>
                        <span className="bva-num">{usd(r.budget)}</span>
                        <span className="bva-num">{usd(r.actual)}</span>
                        <span className={`bva-num ${over ? 'bad' : 'good'}`}>
                          {over ? `over ${usd(-r.diff)}` : `${usd(r.diff)} left`}
                        </span>
                      </button>
                      <div className={`bva-bar ${over ? 'over' : ''}`}><span style={{ width: `${pct}%` }} /></div>
                      {openCat === r.id && (
                        <ul className="pnl-tx-list">
                          {monthTx
                            .filter((t) => t.categoryId === r.id && !t.excluded)
                            .sort((a, b) => Number(b.amount) - Number(a.amount))
                            .map((t) => (
                              <li key={t.id} className="pnl-tx">
                                <span className="pnl-tx-date">{(t.date || '').slice(5)}</span>
                                <span className="pnl-tx-desc">{t.description}</span>
                                <span className={`pnl-tx-amt ${Number(t.amount) < 0 ? 'good' : ''}`}>
                                  {Number(t.amount) < 0 ? `+${usd2(t.amount)}` : usd2(t.amount)}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {Math.abs(otherActual) > 0.005 && (
                  <li className="bva-item">
                    <div className="bva-row">
                      <span className="bva-name">Uncategorized / needs review</span>
                      <span className="bva-num">—</span>
                      <span className="bva-num">{usd(otherActual)}</span>
                      <span className="bva-num muted">not budgeted</span>
                    </div>
                  </li>
                )}
              </ul>
              <div className="bva-row bva-total">
                <span className="bva-name">Total spending</span>
                <span className="bva-num">{usd(totalBudget)}</span>
                <span className="bva-num">{usd(expenses)}</span>
                <span className={`bva-num ${expenses <= totalBudget ? 'good' : 'bad'}`}>
                  {expenses <= totalBudget ? `${usd(totalBudget - expenses)} left` : `over ${usd(expenses - totalBudget)}`}
                </span>
              </div>
            </>
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
      return { m, income: incomeOf(tx, creditIds), expense: expensesOf(tx, creditIds) };
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
