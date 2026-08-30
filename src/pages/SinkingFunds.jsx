import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory } from '../lib/spending';
import { monthlyIncomeTotal, computeCategoryBudgets, envelopeBalances } from '../lib/budgetMath';
import { computeSinkingEnvelope, advanceDueDate, dueLabel } from '../lib/sinkingFunds';

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
const FREQ_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Every 6 months' },
  { value: 'annual', label: 'Yearly' },
];

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function monthKey(dateStr = todayStr()) {
  return dateStr.slice(0, 7);
}

// The Funds tab is a live tracker: sinking funds are created and edited as
// sinking-kind envelopes on the Budget page, and their balance here is the
// real carryover (opening balance + monthly set-aside funded each month −
// anything spent from the envelope). Editing a fund here updates the same
// envelope, so the two stay in sync.
export default function SinkingFunds({ budgetState, setBudgetState, transactions }) {
  const month = monthKey();
  const income = monthlyIncomeTotal(budgetState);
  const budgetable = (budgetState.categories || []).filter((c) => c.id !== 'needs-review');
  const effectiveBudgets = computeCategoryBudgets(budgetable, income);
  const allTimeSpent = netSpentByCategory(transactions);
  const monthSpent = netSpentByCategory(transactions.filter((t) => monthKey(t.date) === month));
  const balances = envelopeBalances(budgetable, effectiveBudgets, allTimeSpent, monthSpent, budgetState.settings?.startMonth, month);

  const sinking = budgetable.filter((c) => c.kind === 'sinking');
  const computed = sinking.map((c) => ({
    envelope: c,
    live: balances[c.id]?.available ?? 0,
    ...computeSinkingEnvelope(c, balances[c.id]?.available ?? 0),
  }));

  const totalSaved = computed.reduce((s, f) => s + f.live, 0);
  const totalTarget = computed.reduce((s, f) => s + Number(f.envelope.targetAmount || 0), 0);
  const requiredMonthly = computed.reduce((s, f) => s + (f.requiredMonthly || 0), 0);

  const upcoming = computed
    .filter((f) => f.nextDueDate && Number(f.envelope.targetAmount || 0) > 0)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  function updateFund(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  function markPaid(f) {
    // The payment itself is a transaction against this envelope (that's what
    // draws the balance down); marking paid just rolls the due date forward.
    updateFund(f.envelope.id, { nextDueDate: advanceDueDate(f.nextDueDate, f.envelope.frequency) });
  }

  return (
    <>
      <h1 className="page-title">Sinking Funds</h1>
      <p className="page-intro">
        One pot per irregular bill. These are your <strong>sinking</strong> envelopes from the Budget —
        each carries its balance forward month to month, so the money is already there when the bill
        comes due. Create or edit them on the Budget page or right here.
      </p>

      <section className="card">
        <div className="card-header">
          <h2>Across all funds</h2>
          <span className="pill">{money(totalSaved)} of {money(totalTarget)} saved</span>
        </div>
        <div className="sf-summary">
          <div className="sf-summary-figure">
            <span className="sf-summary-label">Set aside each month to stay on track</span>
            <span className="sf-summary-value">{money(requiredMonthly)}/mo</span>
          </div>
        </div>
        <p className="module-note">
          Balances update automatically as your monthly set-aside is budgeted and as you spend from a
          fund. To change how much you save into a fund, edit its monthly amount on the Budget page.
        </p>
      </section>

      {upcoming.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Upcoming bills</h2>
          </div>
          <ul className="sf-timeline">
            {upcoming.map((f) => (
              <li key={f.envelope.id} className="sf-timeline-row">
                <span className={`sf-dot sf-dot-${f.status}`} />
                <span className="sf-timeline-name">{f.envelope.name}</span>
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

      <section className="card">
        <div className="card-header">
          <h2>Your funds</h2>
        </div>
        {computed.length === 0 ? (
          <p className="module-note">
            No sinking funds yet. On the Budget page, add an envelope and set its type to
            <strong> Sinking fund</strong>.
          </p>
        ) : (
          <div className="sf-list">
            {computed.map((f) => (
              <FundCard key={f.envelope.id} f={f} onUpdate={updateFund} onMarkPaid={markPaid} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function FundCard({ f, onUpdate, onMarkPaid }) {
  const [expanded, setExpanded] = useState(false);
  const env = f.envelope;
  const hasTarget = Number(env.targetAmount || 0) > 0;

  return (
    <div className={`sf-card sf-card-${f.status}`}>
      <div className="sf-card-top">
        <div className="sf-card-heading">
          <span className="sf-card-name">{env.name}</span>
          {hasTarget && <span className={`pill ${STATUS_CLASS[f.status]}`}>{STATUS_LABEL[f.status]}</span>}
        </div>
        {env.nextDueDate && <span className="sf-card-due">{dueLabel(env.nextDueDate)}</span>}
      </div>

      <div className="sf-card-figures">
        <span className="sf-figure">
          <span className="sf-figure-label">Balance</span>
          <span className="sf-figure-value">{money(f.live)}</span>
        </span>
        <span className="sf-figure">
          <span className="sf-figure-label">Target</span>
          <span className="sf-figure-value">{hasTarget ? money(env.targetAmount) : '—'}</span>
        </span>
        <span className="sf-figure">
          <span className="sf-figure-label">Set aside / mo</span>
          <span className="sf-figure-value">{money(env.budgetValue)}</span>
        </span>
      </div>

      {hasTarget && (
        <div className="bar-track">
          <div className={`bar-fill sf-bar-${f.status}`} style={{ width: `${f.pct}%` }} />
        </div>
      )}

      {f.status === 'behind' && (
        <p className="sf-warn">
          Behind pace — set aside {money(f.requiredMonthly)}/mo (vs. the usual {money(f.ideal)}) to make it
          by {dueLabel(env.nextDueDate)}. Bump this fund&apos;s monthly amount on the Budget page.
        </p>
      )}
      {f.status === 'overdue' && !f.funded && (
        <p className="sf-warn sf-warn-bad">
          Due date passed and you&apos;re {money(f.stillNeeded)} short. After paying it, tap Mark paid to roll
          the due date forward.
        </p>
      )}
      {f.funded && <p className="sf-warn sf-warn-good">Fully funded — the cash is ready for this bill.</p>}

      <div className="sf-card-actions">
        {env.nextDueDate && (
          <button type="button" className="secondary-btn" onClick={() => onMarkPaid(f)}>
            Mark paid
          </button>
        )}
        <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Done' : 'Edit'}
        </button>
      </div>

      {expanded && (
        <div className="sf-edit">
          <label>
            Monthly set-aside
            <input type="number" value={env.budgetValue} onChange={(e) => onUpdate(env.id, { budgetValue: e.target.value })} />
          </label>
          <label>
            Opening balance (already saved)
            <input type="number" value={env.openingBalance ?? 0} onChange={(e) => onUpdate(env.id, { openingBalance: e.target.value })} />
          </label>
          <label>
            Target amount
            <input type="number" value={env.targetAmount ?? ''} placeholder="none" onChange={(e) => onUpdate(env.id, { targetAmount: e.target.value })} />
          </label>
          <label>
            Due date
            <input type="date" value={env.nextDueDate || ''} onChange={(e) => onUpdate(env.id, { nextDueDate: e.target.value })} />
          </label>
          <label>
            Recurs
            <select value={env.frequency || 'annual'} onChange={(e) => onUpdate(env.id, { frequency: e.target.value })}>
              {FREQ_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <p className="module-note">Delete a fund by removing its envelope on the Budget page.</p>
        </div>
      )}
    </div>
  );
}
