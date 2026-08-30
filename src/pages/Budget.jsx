import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory } from '../lib/spending';
import {
  monthlyIncome,
  monthlyIncomeTotal,
  sourceMonthly,
  computeCategoryBudgets,
  envelopeBalances,
  isCarryover,
  ENVELOPE_KINDS,
  INCOME_FREQUENCIES,
} from '../lib/budgetMath';
import TxList from '../components/TxList';

function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}

export default function Budget({ budgetState, setBudgetState, transactions, recategorize, setExcluded, setTaxCategory }) {
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
  // All-time spend per envelope drives the rolling balance for carryover kinds.
  const allTimeSpent = netSpentByCategory(transactions);

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
  const effectiveBudgets = computeCategoryBudgets(budgetableCategories, income);
  const balances = envelopeBalances(
    budgetableCategories,
    effectiveBudgets,
    allTimeSpent,
    spentByCategory,
    budgetState.settings?.startMonth,
    month
  );
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

  // Move an envelope up/down among its group-mates. Reordering the flat
  // categories array is what sticks; the display regroups from that order.
  function moveCategory(id, dir) {
    setBudgetState((prev) => {
      const cats = [...prev.categories];
      const idx = cats.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const group = cats[idx].group || 'Other';
      let swap = -1;
      if (dir < 0) {
        for (let i = idx - 1; i >= 0; i--) if ((cats[i].group || 'Other') === group) { swap = i; break; }
      } else {
        for (let i = idx + 1; i < cats.length; i++) if ((cats[i].group || 'Other') === group) { swap = i; break; }
      }
      if (swap < 0) return prev;
      [cats[idx], cats[swap]] = [cats[swap], cats[idx]];
      return { ...prev, categories: cats };
    });
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
              <input
                type="date"
                className="income-date-input"
                value={s.payDate || ''}
                onChange={(e) => updateSource(s.id, { payDate: e.target.value })}
                title={s.frequency === 'semimonthly' ? 'First pay date of the month' : 'Next date this income lands — used for the cashflow timeline'}
              />
              {s.frequency === 'semimonthly' && (
                <input
                  type="date"
                  className="income-date-input"
                  value={s.payDate2 || ''}
                  onChange={(e) => updateSource(s.id, { payDate2: e.target.value })}
                  title="Second pay date of the month"
                />
              )}
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

      <section className="card">
        <div className="card-header">
          <h2>Envelopes</h2>
          <span className="pill">
            {totalBudgeted > 0 ? `$${totalSpent.toFixed(0)} spent of $${totalBudgeted.toFixed(0)}` : 'Set budgets below to get started'}
          </span>
        </div>

        <div className={`budget-zero ${Math.abs(leftToBudget) < 1 ? 'zero-balanced' : leftToBudget < 0 ? 'zero-over' : 'zero-under'}`}>
          <div className="budget-zero-fig">
            <span className="budget-zero-label">Projected income</span>
            <span className="budget-zero-value">${income.toFixed(0)}</span>
          </div>
          <span className="budget-zero-op">−</span>
          <div className="budget-zero-fig">
            <span className="budget-zero-label">Budgeted</span>
            <span className="budget-zero-value">${totalBudgeted.toFixed(0)}</span>
          </div>
          <span className="budget-zero-op">=</span>
          <div className="budget-zero-fig">
            <span className="budget-zero-label">{leftToBudget < 0 ? 'Over by' : 'Left to budget'}</span>
            <span className="budget-zero-value">${Math.abs(leftToBudget).toFixed(0)}</span>
          </div>
        </div>
        <p className="module-note">
          Give every dollar a job — aim for <strong>$0 left to budget</strong>. Assign the remainder to savings or
          a sinking fund to zero it out.
        </p>

        {groupOrder.map((group) => (
          <div className="category-group" key={group}>
            <h3 className="category-group-title">{group}</h3>
            <div className="category-bars">
              {byGroup[group].map((c) => {
                const spent = spentByCategory[c.id] || 0;
                const budget = effectiveBudgets[c.id] || 0;
                const carry = isCarryover(c.kind);
                const available = balances[c.id]?.available ?? budget - spent;
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
                        <select
                          className="category-kind-select"
                          value={c.kind || 'spending'}
                          onChange={(e) => updateCategory(c.id, 'kind', e.target.value)}
                          title="Bills reset each month; spending, sinking, and transfer envelopes keep their balance"
                        >
                          {ENVELOPE_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                              {k.label}
                            </option>
                          ))}
                        </select>
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
                        {carry && (
                          <span className="category-type-value" title="Cash already in this envelope on your start date">
                            start&nbsp;$
                            <input
                              type="number"
                              className="budget-input"
                              value={c.openingBalance ?? ''}
                              placeholder="0"
                              onChange={(e) => updateCategory(c.id, 'openingBalance', e.target.value)}
                            />
                          </span>
                        )}
                        {c.kind === 'bill' && (
                          <span className="category-type-value" title="Day(s) of the month this bill hits, e.g. 1, 15 — puts it on the cashflow timeline. The monthly budget is split evenly across the days.">
                            due&nbsp;day(s)
                            <input
                              type="text"
                              inputMode="numeric"
                              className="budget-input budget-input-wide"
                              value={c.dueDays ?? (c.dueDay ? String(c.dueDay) : '')}
                              placeholder="e.g. 1, 15"
                              onChange={(e) => updateCategory(c.id, 'dueDays', e.target.value)}
                            />
                          </span>
                        )}
                        <button
                          type="button"
                          className="reorder-btn"
                          aria-label="Move up"
                          onClick={() => moveCategory(c.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="reorder-btn"
                          aria-label="Move down"
                          onClick={() => moveCategory(c.id, 1)}
                        >
                          ↓
                        </button>
                        <button type="button" className="link-btn danger" onClick={() => deleteCategory(c.id)}>
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="category-row-figures">
                      <span className="category-figure">
                        <span className="category-figure-label">Budget/mo</span>
                        <span className="category-figure-value">${budget.toFixed(0)}</span>
                      </span>
                      <span className="category-figure">
                        <span className="category-figure-label">Spent</span>
                        <span className="category-figure-value">${spent.toFixed(0)}</span>
                      </span>
                      <span className={`category-figure ${available < 0 ? 'over-budget' : ''}`}>
                        <span className="category-figure-label">{carry ? 'Available' : 'Left this month'}</span>
                        <span className="category-figure-value">${available.toFixed(0)}</span>
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
                        onSetTaxCategory={setTaxCategory}
                        taxLabels={budgetState.taxLabels}
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

const NEW_GROUP = '__new__';

function AddCategoryForm({ groups, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('spending');
  const [group, setGroup] = useState(groups[0] || 'Other');
  const [newGroup, setNewGroup] = useState('');
  const [budgetValue, setBudgetValue] = useState('');

  const usingNewGroup = group === NEW_GROUP;

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const finalGroup = usingNewGroup ? newGroup.trim() || 'Other' : group;
    onAdd({
      id: `cat-${Date.now()}`,
      name: name.trim(),
      group: finalGroup,
      kind,
      budgetType: 'fixed',
      budgetValue: Number(budgetValue || 0),
    });
  }

  return (
    <form className="add-inline-form add-envelope-form" onSubmit={submit}>
      <input placeholder="Envelope name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Envelope type">
        {ENVELOPE_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
        {groups.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
        <option value={NEW_GROUP}>＋ New group…</option>
      </select>
      {usingNewGroup && (
        <input placeholder="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
      )}
      <input type="number" inputMode="decimal" placeholder="Monthly $" value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} />
      <button type="submit" className="primary-btn">
        Add
      </button>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
