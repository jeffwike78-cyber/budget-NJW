import { useState } from 'react';
import BarChart from '../components/BarChart';
import { PlusIcon, BudgetIcon, AccountsIcon, ArrowUpRightIcon } from '../components/icons';
import { todayStr, todayLabel } from '../lib/storage';
import { isPayrollDeposit } from '../lib/income';
import { netSpentByCategory } from '../lib/spending';
import { monthlyIncomeTotal, computeCategoryBudgets, effectiveBudgetsForMonth, signedBalance } from '../lib/budgetMath';
import { ageOfMoney, ageOfMoneyAdvice, ageOfMoneyStatus } from '../lib/ageOfMoney';
import { projectCashflow } from '../lib/cashflow';
import { creditCardStatus, formatDueDate } from '../lib/creditCard';

function shortDate(str) {
  return new Date(str + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

function lastNMonths(n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export default function Overview({ budgetState, transactions, setView, onQuickScan }) {
  const [showSchedule, setShowSchedule] = useState(false);
  const today = todayStr();
  const month = monthKey(today);
  const monthTx = transactions.filter((t) => monthKey(t.date) === month);

  const income = monthlyIncomeTotal(budgetState);
  const baseBudgets = computeCategoryBudgets(budgetState.categories, income);
  const effectiveBudgets = effectiveBudgetsForMonth(budgetState.categories, baseBudgets, month);
  const totalBudgeted = Object.values(effectiveBudgets).reduce((a, b) => a + b, 0);
  const totalSpent = Object.values(netSpentByCategory(monthTx)).reduce((a, b) => a + b, 0);
  const remaining = totalBudgeted - totalSpent;

  // Expected (budgeted) income vs. what's actually landed this month. Actual =
  // this month's deposits (amount < 0) that aren't excluded (transfers/card
  // payments are auto-excluded, so they don't count as income).
  const expectedIncome = income;
  const actualIncome = monthTx
    .filter((t) => Number(t.amount) < 0 && !t.excluded)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const incomeAhead = actualIncome - expectedIncome;

  const totalBalance = budgetState.accounts.reduce((sum, a) => sum + signedBalance(a), 0);
  const card = creditCardStatus(budgetState.settings, budgetState.accounts, transactions);

  // --- "Think rich" money-health metrics ---
  // Emergency-fund cash = every checking + savings account (liquid money you
  // could tap in a pinch). By type, so it always includes savings, independent
  // of the Envelopes "count as cash" toggle (which governs reconciliation).
  const emergencyCash = budgetState.accounts
    .filter((a) => a.type === 'checking' || a.type === 'savings')
    .reduce((s, a) => s + signedBalance(a), 0);

  // Savings rate: kept / received. Use the most recent COMPLETED month when
  // there is one (stable), falling back to this month early on.
  function monthFinance(key) {
    const tx = transactions.filter((t) => monthKey(t.date) === key);
    const spending = Object.values(netSpentByCategory(tx)).reduce((s, v) => s + v, 0);
    const inc = tx.filter((t) => Number(t.amount) < 0 && !t.excluded).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const rate = inc > 0 ? Math.round(((inc - spending) / inc) * 100) : null;
    return { income: inc, spending, rate };
  }
  const prevKey = lastNMonths(2)[0];
  const prevFin = monthFinance(prevKey);
  const thisFin = monthFinance(month);
  const savings = prevFin.income > 0 ? { ...prevFin, key: prevKey } : { ...thisFin, key: month };
  const savingsLabel = monthLabel(savings.key);

  // Emergency-fund runway: months of expenses your cash covers. Denominator is
  // planned monthly spend (fall back to recent actual if no plan).
  const monthlyExpenses = totalBudgeted > 0 ? totalBudgeted : prevFin.spending || thisFin.spending || 0;
  const runwayMonths = monthlyExpenses > 0 ? emergencyCash / monthlyExpenses : null;

  // Net-worth trend: show whatever monthly snapshots have been recorded, plus
  // this month's live value. We deliberately do NOT auto-save a snapshot from
  // this page — writing the whole shared budget from a screen that only displays
  // it risks a stale tab clobbering everyone's data. Snapshots are recorded
  // safely elsewhere (piggybacked on real budget saves).
  const nwHistory = budgetState.netWorthHistory || {};
  const nwKeys = Object.keys({ ...nwHistory, [month]: totalBalance }).sort();
  const nwSeries = nwKeys.map((k) => (k === month ? Math.round(totalBalance) : Math.round(nwHistory[k])));
  const nwFirst = nwSeries[0];
  const nwChange = nwSeries.length > 1 ? nwSeries[nwSeries.length - 1] - nwFirst : null;

  const chartMonths = lastNMonths(6);
  const chartData = chartMonths.map((key) => {
    const tx = transactions.filter((t) => monthKey(t.date) === key);
    const expense = Object.values(netSpentByCategory(tx)).reduce((s, v) => s + v, 0);
    // Only real paychecks count as income here — Zelle/Venmo/wire transfers
    // the user moves around for investing show up as credits too, but
    // they're not income.
    const income = tx.filter((t) => t.amount < 0 && isPayrollDeposit(t.description)).reduce((s, t) => s + Math.abs(t.amount), 0);
    return { label: monthLabel(key), a: income, b: expense };
  });

  const recent = transactions.slice(0, 5);

  const age = ageOfMoney(transactions);
  const ageStatus = ageOfMoneyStatus(age);
  const agePct = age == null ? 0 : Math.min(100, (age / 45) * 100);

  const creditOwed = budgetState.accounts.filter((a) => a.type === 'credit').reduce((s, a) => s + Number(a.balance || 0), 0);
  const hasCredit = budgetState.accounts.some((a) => a.type === 'credit');
  const showPayoff = hasCredit || budgetState.settings?.payMode === 'card';
  const usd = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // Bills and the card are paid from checking only — savings balances are shown
  // for reference but never counted toward covering the card.
  const checkingBalance = budgetState.accounts
    .filter((a) => a.type === 'checking')
    .reduce((s, a) => s + Number(a.balance || 0), 0);
  const covered = checkingBalance >= creditOwed;
  const cashflow = projectCashflow({
    startingBalance: checkingBalance,
    sources: budgetState.incomeSources,
    categories: budgetState.categories,
    effectiveBudgets,
    // Sinking funds are sinking-kind envelopes now; their due dates + targets
    // drive the outflow side of the timeline.
    sinkingFunds: budgetState.categories.filter((c) => c.kind === 'sinking'),
    days: 30,
  });
  const cashflowShort = cashflow.low < 0;

  return (
    <>
      <h1 className="page-title">Welcome!</h1>

      {card.configured && (
        <section className={`card cc-reminder ${card.paid ? 'cc-reminder-paid' : card.dueSoon ? 'cc-reminder-soon' : ''}`}>
          <div className="cc-reminder-row">
            <span className="cc-reminder-icon" aria-hidden="true">{card.paid ? '✅' : '💳'}</span>
            {card.paid ? (
              <div className="cc-reminder-text">
                <span className="cc-reminder-title">
                  {card.accountName} payment made — {usd(card.paid.amount)} on {formatDueDate(card.paid.date)}
                </span>
                <span className="cc-reminder-sub">
                  Autopay cleared this statement, so nothing’s due {formatDueDate(card.dueDate)}.{' '}
                  {card.balance != null && <>Current running balance: <strong>{usd(card.balance)}</strong>. </>}
                  {card.statementDate != null && <>Next statement closes {formatDueDate(card.statementDate)} (in {card.daysUntilStatement} day{card.daysUntilStatement === 1 ? '' : 's'}).</>}
                </span>
              </div>
            ) : (
              <div className="cc-reminder-text">
                <span className="cc-reminder-title">
                  {card.accountName} payment due {formatDueDate(card.dueDate)}
                  {card.daysUntilDue === 0 ? ' — today' : ` — in ${card.daysUntilDue} day${card.daysUntilDue === 1 ? '' : 's'}`}
                </span>
                <span className="cc-reminder-sub">
                  {card.balance != null && <>Balance to pay: <strong>{usd(card.balance)}</strong>. </>}
                  {card.statementDate != null && <>Statement closes {formatDueDate(card.statementDate)} (in {card.daysUntilStatement} day{card.daysUntilStatement === 1 ? '' : 's'}).</>}
                </span>
              </div>
            )}
            {card.paid ? (
              <span className="pill pill-good">Paid</span>
            ) : (
              card.dueSoon && <span className="pill pill-warn">Due soon</span>
            )}
          </div>
        </section>
      )}

      <section className={`card aom-card aom-${ageStatus}`}>
        <div className="aom-top">
          <div>
            <div className="aom-label">Age of Money</div>
            <div className="aom-value">
              {age == null ? '—' : age} <span className="aom-unit">days</span>
            </div>
          </div>
          <span className={`pill ${ageStatus === 'good' ? 'pill-good' : ageStatus === 'bad' ? 'pill-bad' : 'pill-warn'}`}>
            Goal: 45+
          </span>
        </div>
        <div className="bar-track">
          <div className={`bar-fill aom-bar-${ageStatus}`} style={{ width: `${agePct}%` }} />
        </div>
        <p className="module-note aom-advice">{ageOfMoneyAdvice(age)}</p>
      </section>

      <section className="card money-health">
        <div className="card-header">
          <h2>Money health</h2>
          <span className="pill">the numbers the wealthy watch</span>
        </div>
        <div className="mh-grid">
          <div className="mh-tile">
            <span className="mh-label">Savings rate</span>
            <span className={`mh-value ${savings.rate == null ? '' : savings.rate >= 20 ? 'good' : savings.rate >= 0 ? '' : 'bad'}`}>
              {savings.rate == null ? '—' : `${savings.rate}%`}
            </span>
            <span className="mh-sub">{savings.rate == null ? 'No income recorded yet' : `${savingsLabel} · goal 20%+`}</span>
          </div>
          <div className="mh-tile">
            <span className="mh-label">Emergency runway</span>
            <span className={`mh-value ${runwayMonths == null ? '' : runwayMonths >= 3 ? 'good' : runwayMonths >= 1 ? 'warn' : 'bad'}`}>
              {runwayMonths == null ? '—' : `${runwayMonths.toFixed(1)} mo`}
            </span>
            <span className="mh-sub">{runwayMonths == null ? 'Set a budget to see this' : `${usd(emergencyCash)} in checking + savings · goal 3–6 mo`}</span>
          </div>
          <div className="mh-tile">
            <span className="mh-label">Net worth</span>
            <span className={`mh-value ${totalBalance < 0 ? 'bad' : ''}`}>{usd(totalBalance)}</span>
            <span className="mh-sub">
              {nwChange == null
                ? 'Trend builds as months pass'
                : `${nwChange >= 0 ? '▲' : '▼'} ${usd(Math.abs(nwChange))} since ${monthLabel(nwKeys[0])}`}
            </span>
            <Sparkline values={nwSeries} up={nwChange == null || nwChange >= 0} />
          </div>
        </div>
        <p className="module-note">
          <strong>Savings rate</strong> is how much of what you earn you keep — the real engine of wealth.
          <strong> Runway</strong> is how many months your cash would cover expenses if income stopped (aim 3–6).
          <strong> Net worth</strong> is what you own minus what you owe — watch the slope over time, not any one month.
        </p>
      </section>

      {showPayoff && (
        <section className={`card payoff-card ${covered ? 'payoff-ok' : 'payoff-bad'}`}>
          <div className="card-header">
            <h2>Credit card payoff</h2>
            <span className={`pill ${covered ? 'pill-good' : 'pill-bad'}`}>
              {covered ? 'Covered' : `Short ${usd(creditOwed - checkingBalance)}`}
            </span>
          </div>
          <div className="payoff-figures">
            <div className="payoff-figure">
              <span className="payoff-label">Card balance owed</span>
              <span className="payoff-value">{usd(creditOwed)}</span>
            </div>
            <div className="payoff-figure">
              <span className="payoff-label">Cash in checking</span>
              <span className="payoff-value">{usd(checkingBalance)}</span>
            </div>
          </div>
          <p className="module-note">
            {covered
              ? 'Your checking balance covers the card in full this month. Savings aren’t counted here — they’re shown for reference only.'
              : 'Heads up — build up your checking balance so it covers the card in full. Savings aren’t counted toward this.'}
          </p>
        </section>
      )}

      {cashflow.timeline.length > 0 && (
        <section className={`card cashflow-card ${cashflowShort ? 'payoff-bad' : ''}`}>
          <div className="card-header">
            <h2>Cashflow — next 30 days</h2>
            <span className={`pill ${cashflowShort ? 'pill-bad' : 'pill-good'}`}>
              {cashflowShort ? `Dips to ${usd(cashflow.low)} on ${shortDate(cashflow.lowDate)}` : 'Stays positive'}
            </span>
          </div>
          <div className="payoff-figures">
            <div className="payoff-figure">
              <span className="payoff-label">Checking now</span>
              <span className="payoff-value">{usd(checkingBalance)}</span>
            </div>
            <div className="payoff-figure">
              <span className="payoff-label">Lowest point</span>
              <span className={`payoff-value ${cashflowShort ? 'bad' : ''}`}>{usd(cashflow.low)}</span>
            </div>
            <div className="payoff-figure">
              <span className="payoff-label">In 30 days</span>
              <span className="payoff-value">{usd(cashflow.endingBalance)}</span>
            </div>
          </div>
          {cashflowShort ? (
            <div className="cashflow-buffer cashflow-buffer-warn">
              <span className="cashflow-buffer-label">Buffer to keep in checking</span>
              <span className="cashflow-buffer-value">{usd(cashflow.recommendedBuffer)}</span>
              <p className="module-note">
                Your balance dips {usd(-cashflow.low)} below zero around {shortDate(cashflow.lowDate)} as bills and
                everyday spending land before income catches up. Keep about <strong>{usd(cashflow.recommendedBuffer)}</strong> of
                standing cash in checking so it never overdrafts — a one-time float you top back up as income arrives, not
                money you have to spend.
              </p>
            </div>
          ) : (
            <div className="cashflow-buffer cashflow-buffer-ok">
              <span className="cashflow-buffer-label">No buffer needed</span>
              <span className="cashflow-buffer-value good">$0</span>
              <p className="module-note">
                Income lands in time to cover every bill and about {usd(cashflow.dailySpend * 30.44)}/mo of everyday
                spending — checking stays above zero the whole window.
              </p>
            </div>
          )}
          <button
            type="button"
            className="cashflow-toggle"
            onClick={() => setShowSchedule((s) => !s)}
            aria-expanded={showSchedule}
          >
            {showSchedule ? 'Hide' : 'Show'} upcoming transactions schedule
            {cashflow.timeline.length > 0 ? ` (${cashflow.timeline.length})` : ''} {showSchedule ? '▴' : '▾'}
          </button>
          {showSchedule && (
            <ul className="cashflow-list">
              {cashflow.timeline.map((e, i) => (
                <li key={`${e.date}-${e.name}-${i}`} className="cashflow-row">
                  <span className="cashflow-date">{shortDate(e.date)}</span>
                  <span className="cashflow-name">{e.name}</span>
                  <span className={`cashflow-amount ${e.amount < 0 ? '' : 'good'}`}>
                    {e.amount < 0 ? '-' : '+'}{usd(Math.abs(e.amount))}
                  </span>
                  <span className={`cashflow-balance ${e.balance < 0 ? 'bad' : ''}`}>{usd(e.balance)}</span>
                </li>
              ))}
            </ul>
          )}
          {showSchedule && (
            <p className="module-note">
              Uses each income source&apos;s pay date, each bill&apos;s due day, scheduled transfer days, and a steady
              daily draw for everyday spending. Add due days, transfer days, and pay dates on the Budget page to make
              this complete.
            </p>
          )}
        </section>
      )}

      {expectedIncome > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Income this month</h2>
            <span className={`pill ${incomeAhead >= 0 ? 'pill-good' : 'pill-warn'}`}>
              {incomeAhead >= 0 ? `${usd(incomeAhead)} above plan` : `${usd(-incomeAhead)} to go`}
            </span>
          </div>
          <div className="payoff-figures">
            <div className="payoff-figure">
              <span className="payoff-label">Expected (budgeted)</span>
              <span className="payoff-value">{usd(expectedIncome)}</span>
            </div>
            <div className="payoff-figure">
              <span className="payoff-label">Received so far</span>
              <span className="payoff-value good">{usd(actualIncome)}</span>
            </div>
          </div>
          <p className="module-note">
            {incomeAhead >= 0 ? (
              <>You&apos;ve received <strong>{usd(actualIncome)}</strong> so far — <strong>{usd(incomeAhead)}</strong>{' '}
              more than the {usd(expectedIncome)} you budgeted. Extra income beyond your plan; assign it in the
              Budget or move it to savings.</>
            ) : (
              <>You&apos;ve received <strong>{usd(actualIncome)}</strong> of your <strong>{usd(expectedIncome)}</strong>{' '}
              budgeted income so far — <strong>{usd(-incomeAhead)}</strong> still expected this month. Tag deposits
              with an income category in Transactions.</>
            )}
          </p>
        </section>
      )}

      <div className="overview-grid">
        <section className="card">
          <div className="card-header">
            <h2>My accounts</h2>
          </div>
          <ul className="account-list">
            {budgetState.accounts.map((a) => {
              const bal = signedBalance(a);
              return (
                <li key={a.id} className="account-list-row">
                  <span>{a.name}</span>
                  <span className={`account-list-value${bal < 0 ? ' bad' : ''}`}>
                    {bal < 0 ? `-${usd(Math.abs(bal))}` : usd(bal)}
                  </span>
                </li>
              );
            })}
            <li className="account-list-row account-list-total">
              <span>Total</span>
              <span className={`account-list-value${totalBalance < 0 ? ' bad' : ''}`}>
                {totalBalance < 0 ? `-${usd(Math.abs(totalBalance))}` : usd(totalBalance)}
              </span>
            </li>
          </ul>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Recent transactions</h2>
            <span className="pill">{todayLabel()}</span>
          </div>
          {recent.length === 0 ? (
            <p className="module-note">No transactions yet — add one from the Transactions page.</p>
          ) : (
            <ul className="recent-tx-list">
              {recent.map((t) => (
                <li key={t.id} className="recent-tx-row">
                  <span className="recent-tx-date">{t.date.slice(5)}</span>
                  <span className="recent-tx-desc">{t.description}</span>
                  <span className={`recent-tx-amount ${t.amount < 0 ? 'good' : ''}`}>
                    {t.amount < 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overview-chart-card">
          <div className="card-header">
            <h2>Income &amp; expenses</h2>
            <span className={`pill ${remaining < 0 ? 'pill-bad' : 'pill-good'}`}>
              {totalBudgeted === 0 ? 'Budget not set' : remaining < 0 ? 'Over budget' : `$${remaining.toFixed(0)} left this month`}
            </span>
          </div>
          <BarChart data={chartData} aLabel="Income" bLabel="Expenses" />
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Quick access</h2>
          </div>
          <ul className="quick-access-list">
            <li>
              <button type="button" className="quick-access-item" onClick={() => setView('transactions')}>
                <span className="quick-access-icon">
                  <PlusIcon size={16} />
                </span>
                Add transaction
                <ArrowUpRightIcon size={14} />
              </button>
            </li>
            <li>
              <button type="button" className="quick-access-item" onClick={() => setView('budget')}>
                <span className="quick-access-icon">
                  <BudgetIcon size={16} />
                </span>
                Set category budgets
                <ArrowUpRightIcon size={14} />
              </button>
            </li>
            <li>
              <button type="button" className="quick-access-item" onClick={() => setView('accounts')}>
                <span className="quick-access-icon">
                  <AccountsIcon size={16} />
                </span>
                Manage accounts
                <ArrowUpRightIcon size={14} />
              </button>
            </li>
          </ul>
        </section>
      </div>

      {onQuickScan && (
        <label className="fab-scan" title="Scan a receipt">
          <span aria-hidden="true">📷</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Scan a receipt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onQuickScan(f);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </>
  );
}

// A tiny inline net-worth sparkline. Decorative — the value and change are
// stated in text next to it, so it's aria-hidden.
function Sparkline({ values = [], up = true }) {
  if (!values || values.length < 2) {
    return <div className="mh-spark mh-spark-empty" aria-hidden="true" />;
  }
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={`mh-spark ${up ? 'up' : 'down'}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
