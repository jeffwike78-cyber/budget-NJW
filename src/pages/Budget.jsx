import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory } from '../lib/spending';
import { monthlyIncome, monthlyIncomeTotal, sourceMonthly, computeCategoryBudgets, INCOME_FREQUENCIES } from '../lib/budgetMath';
import TxList from '../components/TxList';

function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}

export default function Budget({ budgetState, setBudgetState, transactions, recategorize, setExcluded, setBusiness, setDeductible }) {
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());
  const [showAdd, setShowAdd] = useState(false);

  function toggleCategory(categoryId) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  const month = monthKey();
  const monthTx = transactions.filter((t) => monthKey(t.date) === month);
  const spentByCategory = netSpentByCategory(monthTx);

  // Income sources — migrate the legacy single income into one source the first
  // time, so nothing is lost for setups saved before multi-source income.
  const incomeSources =
    budgetState.incomeSources ||
    (monthlyIncome(budgetState.income) > 0
      ? [{ id: 'inc-legacy', name: 'Income', amount: monthlyIncome(budgetState.income), frequency: 'monthly' }]
      : []);
  const income = monthlyIncomeTotal({ ...budgetState, incomeSources });
  // Needs Review isn't a real spending category — it's a flag, not something to
  // set a dollar target for — so it's excluded from the budget-bar list.
  const budgetableCategories = budgetState.categories.filter((c) => c.id !== 'needs-review');
  const needsReview = transactions.filter((t) => t.categoryId === 'needs-review' && Number(t.amount) > 0);
  const effectiveBudgets = computeCategoryBudgets(budgetableCategories, income);
  const hasRemainderCategory = budgetableCategories.some((c) => c.budgetType === 'remainder');
  const totalBudgeted = Object.values(effectiveBudgets).reduce((a, b) => a + b, 0);
  const totalSpent = Object.values(spentByCategory).reduce((a, b) => a + b, 0);
  const leftToBudget = income - totalBudgeted;

  // Group the envelopes for display (Giving, Housing, Food…), preserving the
  // order groups first appear in.
  const groupOrder = [];
  const byGroup = {};
  for (const c of budgetableCategories) {
    const g = c.group || 'Other';
    if (!byGroup[g]) {
      byGroup[g] = [];
      groupOrder.push(g);
    }
    byGroup[g].push(c);
  }

  function updateCategory(categoryId, field, value) {
    setBudgetState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id === categoryId ? { ...c, [field]: value } : c)),
    }));
  }

  function deleteCategory(categoryId) {
    setBudgetState((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c.id !== categoryId),
    }));
  }

  function addCategory(cat) {
    setBudgetState((prev) => ({ ...prev, categories: [...prev.categories, cat] }));
    setShowAdd(false);
  }

  function updateSource(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      incomeSources: (prev.incomeSources || incomeSources).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }

  function deleteSource(id) {
    setBudgetState((prev) => ({
      ...prev,
      incomeSources: (prev.incomeSources || incomeSources).filter((s) => s.id !== id),
    }));
  }

  function addSource() {
    const src = { id: `inc-${Date.now()}`, name: '', amount: 0, frequency: 'monthly' };
    setBudgetState((prev) => ({ ...prev, incomeSources: [...(prev.incomeSources || incomeSources), src] }));
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
        <div className="income-sources">
          {incomeSources.map((s) => (
            <div className="income-source-row" key={s.id}>
              <input
                className="income-name-input"
                placeholder="Source name"
                value={s.name}
                onChange={(e) => updateSource(s.id, { name: e.target.value })}
              />
              <span className="income-amount">
                $
                <input
                  type="number"
                  inputMode="decimal"
                  className="budget-input"
                  value={s.amount}
                  onChange={(e) => updateSource(s.id, { amount: e.target.value })}
                />
              </span>
              <select value={s.frequency} onChange={(e) => updateSource(s.id, { frequency: e.target.value })}>
                {INCOME_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <span className="income-monthly">${sourceMonthly(s).toFixed(0)}/mo</span>
              <button type="button" className="link-btn danger" onClick={() => deleteSource(s.id)}>
                ✕
              </button>
            </div>
          ))}
          {incomeSources.length === 0 && <p className="module-note">No income sources yet — add one below.</p>}
        </div>
        <div className="income-footer">
          <button type="button" className="secondary-btn" onClick={addSource}>
            + Add income source
          </button>
          <span className="income-total">Total: ${income.toFixed(0)}/mo</span>
        </div>
        <p className="module-note">
          Each source lands on its own cadence; the app sums their monthly-equivalent to show how much
          is left to budget.
        </p>
      </section>

      {needsReview.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Needs Review</h2>
            <span className="pill">{needsReview.length} flagged</span>
          </div>
          <p className="module-note">
            These couldn&apos;t be confidently placed — sort each one into the right envelope below.
          </p>
          <TxList
            transactions={needsReview}
            categories={budgetState.categories}
            onRecategorize={handleRecategorize}
            onToggleExcluded={setExcluded}
            onToggleBusiness={setBusiness}
            onToggleDeductible={setDeductible}
            showReceiptLookup
          />
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Envelopes</h2>
          <span className="pill">
            {totalBudgeted > 0 ? `$${totalSpent.toFixed(0)} of $${totalBudgeted.toFixed(0)} this month` : 'Set budgets below to get started'}
          </span>
        </div>

        {groupOrder.map((group) => (
          <div className="category-group" key={group}>
            <h3 className="category-group-title">{group}</h3>
            <div className="category-bars">
              {byGroup[group].map((c) => {
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
                      <input
                        className="category-name-input"
                        value={c.name}
                        onChange={(e) => updateCategory(c.id, 'name', e.target.value)}
                      />
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
                        <button type="button" className="link-btn danger" onClick={() => deleteCategory(c.id)}>
                          ✕
                        </button>
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
                        onToggleBusiness={setBusiness}
                        onToggleDeductible={setDeductible}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {showAdd ? (
          <AddCategoryForm groups={groupOrder} onAdd={addCategory} onCancel={() => setShowAdd(false)} />
        ) : (
          <button type="button" className="secondary-btn" onClick={() => setShowAdd(true)}>
            + Add envelope
          </button>
        )}
      </section>
    </>
  );
}

function AddCategoryForm({ groups, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState(groups[0] || 'Other');
  const [budgetValue, setBudgetValue] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: `cat-${Date.now()}`,
      name: name.trim(),
      group,
      budgetType: 'fixed',
      budgetValue: Number(budgetValue || 0),
    });
  }

  return (
    <form className="add-inline-form" onSubmit={submit}>
      <input placeholder="Envelope name" value={name} onChange={(e) => setName(e.target.value)} />
      <input list="budget-groups" placeholder="Group" value={group} onChange={(e) => setGroup(e.target.value)} />
      <datalist id="budget-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <input type="number" placeholder="Monthly $" value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} />
      <button type="submit" className="primary-btn">
        Add
      </button>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
