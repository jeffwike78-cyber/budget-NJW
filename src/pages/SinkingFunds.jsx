import { useState } from 'react';
import { todayStr } from '../lib/storage';
import {
  computeFund,
  advanceDueDate,
  dueLabel,
  totalRequiredMonthly,
} from '../lib/sinkingFunds';

function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}

const STATUS_LABEL = {
  funded: 'Fully funded',
  'on-track': 'On track',
  behind: 'Behind',
  overdue: 'Overdue',
};

const STATUS_CLASS = {
  funded: 'pill-good',
  'on-track': 'pill-good',
  behind: 'pill-warn',
  overdue: 'pill-bad',
};

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function SinkingFunds({ budgetState, setBudgetState }) {
  const [showAdd, setShowAdd] = useState(false);
  const funds = budgetState.sinkingFunds || [];
  const computed = funds.map((f) => computeFund(f));
  const thisMonth = monthKey();

  const totalSaved = funds.reduce((s, f) => s + Number(f.balance || 0), 0);
  const totalTarget = funds.reduce((s, f) => s + Number(f.targetAmount || 0), 0);
  const requiredThisMonth = totalRequiredMonthly(funds);
  const alreadyFundedThisMonth = funds.filter((f) => f.lastFunded === thisMonth).length;

  const upcoming = [...computed]
    .filter((f) => f.nextDueDate)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  function updateFund(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      sinkingFunds: prev.sinkingFunds.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function deleteFund(id) {
    setBudgetState((prev) => ({
      ...prev,
      sinkingFunds: prev.sinkingFunds.filter((f) => f.id !== id),
    }));
  }

  function addContribution(id, amount) {
    const add = Number(amount);
    if (!add) return;
    setBudgetState((prev) => ({
      ...prev,
      sinkingFunds: prev.sinkingFunds.map((f) =>
        f.id === id ? { ...f, balance: Number(f.balance || 0) + add } : f
      ),
    }));
  }

  function markPaid(fund) {
    const target = Number(fund.targetAmount || 0);
    updateFund(fund.id, {
      balance: Math.max(0, Number(fund.balance || 0) - target),
      nextDueDate: advanceDueDate(fund.nextDueDate, fund.frequency),
    });
  }

  // Deposit this month's suggested set-aside into every fund that still needs
  // it and hasn't already been funded this month.
  function setAsideThisMonth() {
    setBudgetState((prev) => ({
      ...prev,
      sinkingFunds: prev.sinkingFunds.map((f) => {
        if (f.lastFunded === thisMonth) return f;
        const c = computeFund(f);
        if (c.requiredMonthly <= 0) return f;
        return {
          ...f,
          balance: Number(f.balance || 0) + Math.round(c.requiredMonthly * 100) / 100,
          lastFunded: thisMonth,
        };
      }),
    }));
  }

  function addFund(fund) {
    setBudgetState((prev) => ({ ...prev, sinkingFunds: [...(prev.sinkingFunds || []), fund] }));
    setShowAdd(false);
  }

  return (
    <>
      <h1 className="page-title">Sinking Funds</h1>
      <p className="page-intro">
        One pot per irregular bill. Add a little each month so the money is already there when the
        bill comes due — no more coming up short.
      </p>

      {/* Summary + monthly set-aside */}
      <section className="card">
        <div className="card-header">
          <h2>This month</h2>
          <span className="pill">{money(totalSaved)} of {money(totalTarget)} set aside</span>
        </div>
        <div className="sf-summary">
          <div className="sf-summary-figure">
            <span className="sf-summary-label">Set aside to stay on track</span>
            <span className="sf-summary-value">{money(requiredThisMonth)}/mo</span>
          </div>
          <button
            type="button"
            className="primary-btn"
            onClick={setAsideThisMonth}
            disabled={alreadyFundedThisMonth === funds.length && funds.length > 0}
          >
            {alreadyFundedThisMonth === funds.length && funds.length > 0
              ? 'All funded this month ✓'
              : `Set aside this month's ${money(requiredThisMonth)}`}
          </button>
        </div>
        <p className="module-note">
          "Set aside this month" adds each fund's suggested amount to its balance and marks it done
          for {thisMonth}. You can also add money to any single fund below, or type in the real
          balance if you already have cash saved.
        </p>
      </section>

      {/* Upcoming bills timeline */}
      {upcoming.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Upcoming bills</h2>
          </div>
          <ul className="sf-timeline">
            {upcoming.map((f) => (
              <li key={f.id} className="sf-timeline-row">
                <span className={`sf-dot sf-dot-${f.status}`} />
                <span className="sf-timeline-name">{f.name}</span>
                <span className="sf-timeline-due">{dueLabel(f.nextDueDate)}</span>
                <span className="sf-timeline-amount">
                  {f.funded ? (
                    <span className="pill pill-good">Ready</span>
                  ) : f.stillNeeded > 0 ? (
                    <span className={`pill ${STATUS_CLASS[f.status]}`}>short {money(f.stillNeeded)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Individual funds */}
      <section className="card">
        <div className="card-header">
          <h2>Your funds</h2>
          <button type="button" className="secondary-btn" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? 'Cancel' : '+ Add a fund'}
          </button>
        </div>

        {showAdd && <AddFundForm onAdd={addFund} />}

        <div className="sf-list">
          {computed.map((f) => (
            <FundCard
              key={f.id}
              fund={f}
              onUpdate={updateFund}
              onDelete={deleteFund}
              onAddContribution={addContribution}
              onMarkPaid={markPaid}
            />
          ))}
          {computed.length === 0 && (
            <p className="module-note">No sinking funds yet — add one above.</p>
          )}
        </div>
      </section>
    </>
  );
}

function FundCard({ fund, onUpdate, onDelete, onAddContribution, onMarkPaid }) {
  const [expanded, setExpanded] = useState(false);
  const [addAmount, setAddAmount] = useState('');

  return (
    <div className={`sf-card sf-card-${fund.status}`}>
      <div className="sf-card-top">
        <div className="sf-card-heading">
          <span className="sf-card-name">{fund.name}</span>
          <span className={`pill ${STATUS_CLASS[fund.status]}`}>{STATUS_LABEL[fund.status]}</span>
        </div>
        <span className="sf-card-due">{dueLabel(fund.nextDueDate)}</span>
      </div>

      <div className="sf-card-figures">
        <span className="sf-figure">
          <span className="sf-figure-label">Saved</span>
          <span className="sf-figure-value">{money(fund.balance)}</span>
        </span>
        <span className="sf-figure">
          <span className="sf-figure-label">Target</span>
          <span className="sf-figure-value">{money(fund.target)}</span>
        </span>
        <span className="sf-figure">
          <span className="sf-figure-label">Set aside / mo</span>
          <span className="sf-figure-value">{money(fund.requiredMonthly)}</span>
        </span>
      </div>

      <div className="bar-track">
        <div className={`bar-fill sf-bar-${fund.status}`} style={{ width: `${fund.pct}%` }} />
      </div>

      {fund.status === 'behind' && (
        <p className="sf-warn">
          Behind pace — set aside {money(fund.requiredMonthly)}/mo (vs. the usual {money(fund.ideal)}) to
          make it by {dueLabel(fund.nextDueDate)}.
        </p>
      )}
      {fund.status === 'overdue' && !fund.funded && (
        <p className="sf-warn sf-warn-bad">
          Due date has passed and you're {money(fund.stillNeeded)} short. Update the balance, or set a
          new due date after paying it.
        </p>
      )}
      {fund.funded && (
        <p className="sf-warn sf-warn-good">Fully funded — the cash is ready when this bill comes due.</p>
      )}

      <div className="sf-card-actions">
        <div className="sf-add-inline">
          <input
            type="number"
            inputMode="decimal"
            placeholder="Add $"
            className="budget-input"
            value={addAmount}
            onChange={(e) => setAddAmount(e.target.value)}
          />
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              onAddContribution(fund.id, addAmount);
              setAddAmount('');
            }}
          >
            Add
          </button>
        </div>
        <button type="button" className="secondary-btn" onClick={() => onMarkPaid(fund)}>
          Mark paid
        </button>
        <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>

      {expanded && (
        <div className="sf-edit">
          <label>
            Name
            <input value={fund.name} onChange={(e) => onUpdate(fund.id, { name: e.target.value })} />
          </label>
          <label>
            Current balance
            <input
              type="number"
              value={fund.balance}
              onChange={(e) => onUpdate(fund.id, { balance: e.target.value })}
            />
          </label>
          <label>
            Target amount
            <input
              type="number"
              value={fund.targetAmount}
              onChange={(e) => onUpdate(fund.id, { targetAmount: e.target.value })}
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={fund.nextDueDate || ''}
              onChange={(e) => onUpdate(fund.id, { nextDueDate: e.target.value })}
            />
          </label>
          <label>
            Recurs
            <select
              value={fund.frequency}
              onChange={(e) => onUpdate(fund.id, { frequency: e.target.value })}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="semiannual">Every 6 months</option>
              <option value="annual">Yearly</option>
            </select>
          </label>
          <button type="button" className="link-btn danger" onClick={() => onDelete(fund.id)}>
            Delete this fund
          </button>
        </div>
      )}
    </div>
  );
}

function AddFundForm({ onAdd }) {
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [frequency, setFrequency] = useState('annual');

  function submit(e) {
    e.preventDefault();
    if (!name.trim() || !targetAmount) return;
    onAdd({
      id: `sf-${Date.now()}`,
      name: name.trim(),
      group: 'Other',
      targetAmount: Number(targetAmount),
      frequency,
      nextDueDate: nextDueDate || null,
      balance: 0,
    });
  }

  return (
    <form className="sf-add-form" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Property taxes" />
      </label>
      <label>
        Target $
        <input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="0" />
      </label>
      <label>
        Due date
        <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
      </label>
      <label>
        Recurs
        <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="semiannual">Every 6 months</option>
          <option value="annual">Yearly</option>
        </select>
      </label>
      <button type="submit" className="primary-btn">Add fund</button>
    </form>
  );
}
