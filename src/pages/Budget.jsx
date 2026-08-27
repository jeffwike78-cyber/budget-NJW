import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory } from '../lib/spending';
import { monthlyIncome, computeCategoryBudgets } from '../lib/budgetMath';
import TxList from '../components/TxList';

function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}

export default function Budget({ budgetState, setBudgetState, transactions, recategorize, setExcluded }) {
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());

  function toggleCategory(categoryId) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  const month = monthKey();
  const monthTx = transactions.filter((t) => monthKey(t.date) === month);
  const spentByCategory = netSpentByCategory(monthTx);

  const income = monthlyIncome(budgetState.income);
  // Needs Review isn't a real spending category — it's a flag, not something to set a
  // dollar target for — so it's excluded from the budget-bar list and shown separately.
  const budgetableCategories = budgetState.categories.filter((c) => c.id !== 'needs-review');
  // Needs Review is for unclear spending, not unclear deposits — money coming in
  // (amount < 0) never belongs here, even if it somehow got flagged that way.
  const needsReview = transactions.filter((t) => t.categoryId === 'needs-review' && Number(t.amount) > 0);
  const effectiveBudgets = computeCategoryBudgets(budgetableCategories, income);
  const hasRemainderCategory = budgetableCategories.some((c) => c.budgetType === 'remainder');
  const totalBudgeted = Object.values(effectiveBudgets).reduce((a, b) => a + b, 0);
  const totalSpent = Object.values(spentByCategory).reduce((a, b) => a + b, 0);
  const leftToBudget = income - totalBudgeted;

  function updateCategory(categoryId, field, value) {
    setBudgetState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id === categoryId ? { ...c, [field]: value } : c)),
    }));
  }

  function updateIncome(field, value) {
    setBudgetState((prev) => ({ ...prev, income: { ...prev.income, [field]: value } }));
  }

  async function handleRecategorize(txId, categoryId) {
    const tx = transactions.find((t) => t.id === txId);
    await recategorize(txId, categoryId);
    if (tx) {
      const key = tx.description.trim().toLowerCase();
      setBudgetState((prev) => ({ ...prev, merchantMemory: { ...prev.merchantMemory, [key]: categoryId } }));
    }
  }

  return (
    <>
      <h1 className="page-title">Budget</h1>

      <section className="card">
        <div className="card-header">
          <h2>Income</h2>
          {income > 0 && (
            <span className={`pill ${leftToBudget < 0 ? 'pill-bad' : 'pill-good'}`}>
              {hasRemainderCategory && Math.abs(leftToBudget) < 1
                ? 'Fully allocated'
                : leftToBudget < 0
                ? `$${Math.abs(leftToBudget).toFixed(0)} over`
                : `$${leftToBudget.toFixed(0)} left to budget`}
            </span>
          )}
        </div>
        {budgetState.income?.auto ? (
          <>
            <p className="module-note">
              Auto-detected from your paycheck deposits — average of the last few: <strong>${Number(budgetState.income.paycheckAmount).toFixed(0)}</strong> every 2 weeks.
            </p>
            {income > 0 && (
              <p className="module-note">
                ≈ ${income.toFixed(0)}/month averaged (26 paychecks a year, not exactly 24, so most months get 2 but some get 3).
                Transfers you move around for investing (Zelle, Venmo, wires) aren't counted here.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="income-form">
              <label>
                Paycheck amount
                <input
                  type="number"
                  inputMode="decimal"
                  value={budgetState.income?.paycheckAmount ?? 0}
                  onChange={(e) => updateIncome('paycheckAmount', e.target.value)}
                />
              </label>
              <label>
                How often
                <select value={budgetState.income?.frequency ?? 'biweekly'} onChange={(e) => updateIncome('frequency', e.target.value)}>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Once a month</option>
                </select>
              </label>
            </div>
            <p className="module-note">
              No payroll deposits detected yet — this will switch to auto-detected once a transaction with "payroll" in the
              description syncs in.
            </p>
          </>
        )}
      </section>

      {needsReview.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Needs Review</h2>
            <span className="pill">{needsReview.length} flagged</span>
          </div>
          <p className="module-note">
            Paul couldn&apos;t confidently place these — not a budget line, just sort them into the
            right category below.
          </p>
          <TxList
            transactions={needsReview}
            categories={budgetState.categories}
            onRecategorize={handleRecategorize}
            onToggleExcluded={setExcluded}
          />
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Category budgets</h2>
          <span className="pill">{totalBudgeted > 0 ? `$${totalSpent.toFixed(0)} of $${totalBudgeted.toFixed(0)} this month` : 'Set budgets below to get started'}</span>
        </div>
        <div className="category-bars">
          {budgetableCategories.map((c) => {
            const spent = spentByCategory[c.id] || 0;
            const budget = effectiveBudgets[c.id] || 0;
            const remaining = budget - spent;
            const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
            const over = budget > 0 && spent > budget;
            const categoryTx = monthTx.filter((t) => t.categoryId === c.id);
            const isExpanded = expandedCategories.has(c.id);
            return (
              <div className="category-row" key={c.id}>
                <div className="category-row-header">
                  <span className="category-row-name">{c.name}</span>
                  <div className="category-type-control">
                    <select value={c.budgetType} onChange={(e) => updateCategory(c.id, 'budgetType', e.target.value)}>
                      <option value="fixed">Fixed $</option>
                      <option value="percent">% of income</option>
                      <option value="remainder">Whatever's left</option>
                    </select>
                    {c.budgetType !== 'remainder' && (
                      <span className="category-type-value">
                        {c.budgetType === 'percent' ? null : '$'}
                        <input
                          type="number"
                          className="budget-input"
                          value={c.budgetValue}
                          onChange={(e) => updateCategory(c.id, 'budgetValue', e.target.value)}
                        />
                        {c.budgetType === 'percent' ? '%' : null}
                      </span>
                    )}
                  </div>
                </div>

                <div className="category-row-figures">
                  <span className="category-figure">
                    <span className="category-figure-label">Budget</span>
                    <span className="category-figure-value">${budget.toFixed(0)}</span>
                  </span>
                  <span className="category-figure">
                    <span className="category-figure-label">Spent</span>
                    <span className="category-figure-value">${spent.toFixed(0)}</span>
                  </span>
                  <span className={`category-figure ${remaining < 0 ? 'over-budget' : ''}`}>
                    <span className="category-figure-label">Remaining</span>
                    <span className="category-figure-value">${remaining.toFixed(0)}</span>
                  </span>
                </div>

                <div className="bar-track">
                  <div className={`bar-fill${over ? ' over' : ''}`} style={{ width: `${pct}%` }} />
                </div>

                <button
                  type="button"
                  className="category-expand-toggle"
                  onClick={() => toggleCategory(c.id)}
                  disabled={categoryTx.length === 0}
                >
                  {categoryTx.length === 0
                    ? 'No transactions this month'
                    : `${isExpanded ? 'Hide' : 'Show'} ${categoryTx.length} transaction${categoryTx.length === 1 ? '' : 's'} ${isExpanded ? '▴' : '▾'}`}
                </button>

                {isExpanded && categoryTx.length > 0 && (
                  <TxList
                    transactions={categoryTx}
                    categories={budgetState.categories}
                    onRecategorize={handleRecategorize}
                    onToggleExcluded={setExcluded}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
