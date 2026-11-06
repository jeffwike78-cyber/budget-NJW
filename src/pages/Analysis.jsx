import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { monthsList, monthlyIncomeTotal, computeCategoryBudgets, effectiveBudgetsForMonth, envelopeBalances, adjustmentMaps, cashReconciliation } from '../lib/budgetMath';
import { netSpentByCategory, spendingCategoryIds } from '../lib/spending';
import { buildAnalysisData, generateAnalysis } from '../lib/analysisClient';

const usd0 = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}

// Current-month reconciliation (does cash cover what's set aside after bills +
// card payoff), used for the over-assigned banner atop the analysis.
function currentRecon(budgetState, transactions) {
  const month = monthKey();
  const cats = budgetState.categories || [];
  const income = monthlyIncomeTotal(budgetState);
  const base = computeCategoryBudgets(cats, income);
  const eff = effectiveBudgetsForMonth(cats, base, month);
  const creditIds = spendingCategoryIds(budgetState);
  const monthTx = transactions.filter((t) => monthKey(t.date) === month);
  const monthSpent = netSpentByCategory(monthTx, creditIds);
  const { all, month: adjMonth } = adjustmentMaps(budgetState.adjustments, month);
  const balances = envelopeBalances(cats, base, netSpentByCategory(transactions, creditIds), monthSpent, budgetState.settings?.startMonth, month, all, adjMonth);
  return cashReconciliation(budgetState, balances, eff, monthSpent);
}
function monthLabel(m) {
  return new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function Analysis({ budgetState, setBudgetState, transactions, embedded = false }) {
  const current = monthKey();
  // Months available to analyze: start month through the current month, newest
  // first. Default to the most recent completed month when there is one.
  const months = monthsList(budgetState.settings?.startMonth || current, current).slice().reverse();
  const defaultMonth = months.find((m) => m < current) || months[0] || current;
  const [selected, setSelected] = useState(defaultMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const saved = (budgetState.analyses || []).find((a) => a.month === selected);
  const report = saved?.report;
  const recon = currentRecon(budgetState, transactions);

  async function runAnalysis() {
    setBusy(true);
    setError(null);
    try {
      const data = buildAnalysisData(budgetState, transactions, selected);
      const result = await generateAnalysis(data);
      const entry = { month: selected, generatedAt: new Date().toISOString(), report: result };
      setBudgetState((prev) => {
        const rest = (prev.analyses || []).filter((a) => a.month !== selected);
        const next = [...rest, entry].sort((a, b) => a.month.localeCompare(b.month));
        return { ...prev, analyses: next };
      });
    } catch (err) {
      setError(err.message || 'Could not generate the analysis.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!embedded && <h1 className="page-title">Analysis</h1>}
      {recon.overAssigned && (
        <section className="card reconcile-banner reconcile-warn">
          <div className="reconcile-row">
            <span className="reconcile-value">⚠️ Over-assigned {usd0(-recon.freeToAssign)}</span>
          </div>
          <p className="module-note">
            Your envelopes have {usd0(-recon.freeToAssign)} more set aside than your checking covers once this
            month&apos;s bills and credit-card payoff are accounted for. If that money sits in a savings account, mark
            it included in Accounts; otherwise a fund needs a boost before it&apos;s backed by real cash. (Available
            cash {usd0(recon.availableCash)} vs set aside {usd0(recon.assigned)}.)
          </p>
        </section>
      )}
      <p className="page-intro no-print">
        A monthly read on your money from AI — where spending is drifting, what&apos;s going well, and concrete
        ways to save more. It looks back over past months too, so the picture sharpens over time.
      </p>

      <section className="card no-print">
        <div className="analysis-controls">
          <label className="analysis-month">
            <span>Month</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary-btn" onClick={runAnalysis} disabled={busy}>
            {busy ? 'Analyzing…' : report ? 'Regenerate' : 'Generate analysis'}
          </button>
          {report && (
            <button type="button" className="secondary-btn" onClick={() => window.print()}>
              🖨 Print / Save PDF
            </button>
          )}
        </div>
        {saved && (
          <p className="module-note">
            Last generated {new Date(saved.generatedAt).toLocaleString()}. Regenerate to refresh with the latest
            transactions.
          </p>
        )}
        {error && <p className="module-note form-error">{error}</p>}
      </section>

      {report ? (
        <section className="card analysis-report">
          <div className="analysis-report-head">
            <span className="analysis-report-month">{monthLabel(selected)}</span>
            <h2>{report.headline}</h2>
            {typeof report.savingsRate === 'number' && (
              <span className={`pill ${report.savingsRate >= 15 ? 'pill-good' : report.savingsRate >= 0 ? 'pill-warn' : 'pill-bad'}`}>
                Savings rate {report.savingsRate}%
              </span>
            )}
          </div>
          {report.summary && <p className="analysis-summary">{report.summary}</p>}

          {report.sections?.map((s, i) => (
            <div className="analysis-section" key={i}>
              <h3>{s.heading}</h3>
              <ul>
                {s.points.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          ))}

          {report.recommendations?.length > 0 && (
            <div className="analysis-section analysis-recs">
              <h3>Recommendations</h3>
              <ul>
                {report.recommendations.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {report.watch?.length > 0 && (
            <div className="analysis-section">
              <h3>Watch next month</h3>
              <ul>
                {report.watch.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="analysis-disclaimer">
            Generated by AI from your budget and transactions for {monthLabel(selected)}. A helpful second opinion —
            not professional financial advice.
          </p>
        </section>
      ) : (
        <section className="card no-print">
          <p className="module-note">
            No analysis for {monthLabel(selected)} yet. Tap <strong>Generate analysis</strong> and the AI will review
            that month against your budget and recent history.
          </p>
        </section>
      )}
    </>
  );
}
