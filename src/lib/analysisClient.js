import { netSpentByCategory } from './spending';
import { monthlyIncomeTotal, computeCategoryBudgets, effectiveBudgetsForMonth } from './budgetMath';

function monthKey(dateStr) {
  return (dateStr || '').slice(0, 7);
}
function round(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// Deposits that landed in a month = income actually received (amount < 0, not
// excluded — transfers/card payments are auto-excluded upstream).
function actualIncomeForMonth(transactions, month) {
  return transactions
    .filter((t) => monthKey(t.date) === month && Number(t.amount) < 0 && !t.excluded)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
}

// One month's rolled-up figures for the AI payload.
function monthAggregate(budgetState, transactions, month) {
  const cats = (budgetState.categories || []).filter((c) => c.id !== 'needs-review');
  const income = monthlyIncomeTotal(budgetState);
  const base = computeCategoryBudgets(cats, income);
  const eff = effectiveBudgetsForMonth(cats, base, month);
  const spentMap = netSpentByCategory(transactions.filter((t) => monthKey(t.date) === month));
  const spending = Object.values(spentMap).reduce((a, b) => a + b, 0);
  const actualIncome = actualIncomeForMonth(transactions, month);
  const byCategory = cats
    .map((c) => ({ name: c.name, kind: c.kind, budget: round(eff[c.id] || 0), spent: round(spentMap[c.id] || 0) }))
    .filter((c) => c.budget > 0 || c.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const savingsRate = actualIncome > 0 ? round(((actualIncome - spending) / actualIncome) * 100) : null;
  return { month, expectedIncome: round(income), actualIncome: round(actualIncome), spending: round(spending), savingsRate, byCategory };
}

function topMerchants(transactions, month, limit = 15) {
  const totals = {};
  for (const t of transactions) {
    if (monthKey(t.date) !== month) continue;
    if (Number(t.amount) <= 0 || t.excluded) continue;
    const key = (t.description || 'Unknown').trim();
    if (!totals[key]) totals[key] = { description: key, total: 0, count: 0 };
    totals[key].total += Number(t.amount);
    totals[key].count += 1;
  }
  return Object.values(totals)
    .map((m) => ({ ...m, total: round(m.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// Build the JSON payload the analysis endpoint turns into a report: the focus
// month in detail, up to 6 prior months for trend, and past report headlines
// so the AI builds on itself over time.
export function buildAnalysisData(budgetState, transactions, month, monthsBack = 6) {
  const focus = monthAggregate(budgetState, transactions, month);
  const history = [];
  let [y, m] = month.split('-').map(Number);
  for (let i = 0; i < monthsBack; i++) {
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const start = budgetState.settings?.startMonth;
    if (start && key < start) break;
    const agg = monthAggregate(budgetState, transactions, key);
    if (agg.spending > 0 || agg.actualIncome > 0) {
      history.push({
        month: key,
        actualIncome: agg.actualIncome,
        spending: agg.spending,
        savingsRate: agg.savingsRate,
        topCategories: agg.byCategory.slice(0, 6).map((c) => ({ name: c.name, spent: c.spent })),
      });
    }
  }
  const priorReports = (budgetState.analyses || [])
    .slice(-6)
    .map((a) => ({ month: a.month, headline: a.report?.headline }))
    .filter((a) => a.headline);

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return {
    month,
    monthLabel,
    currency: 'USD',
    income: { expected: focus.expectedIncome, actual: focus.actualIncome },
    spending: { budgeted: round(focus.byCategory.reduce((s, c) => s + c.budget, 0)), actual: focus.spending },
    savingsRate: focus.savingsRate,
    categories: focus.byCategory,
    topMerchants: topMerchants(transactions, month),
    history,
    priorReports,
  };
}

export async function generateAnalysis(data) {
  const res = await fetch('/api/analysis/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not generate the analysis.');
  return json.report;
}
