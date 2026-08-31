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
  const computed = sinking.map((c) => {
    const live = balances[c.id]?.available ?? 0;
    const base = computeSinkingEnvelope(c, live);
    // What you'll actually have by the due date if you keep contributing the
    // budgeted monthly amount: current balance + months left × monthly set-aside.
    const monthly = effectiveBudgets[c.id] || Number(c.budgetValue || 0);
    const target = Number(c.targetAmount || 0);
    const projected = live + (base.remaining || 0) * monthly;
    const onTrack = target > 0 ? projected >= target - 0.5 : true;
    const projectedShort = target > 0 ? Math.max(0, target - projected) : 0;
    return { envelope: c, live, monthly, projected, onTrack, projectedShort, ...base };
  });

  const totalSaved = computed.reduce((s, f) => s + f.live, 0);
  const totalTarget = computed.reduce((s, f) => s + Number(f.envelope.targetAmount || 0), 0);
  const requiredMonthly = computed.reduce((s, f) => s + (f.requiredMonthly || 0), 0);

  const upcoming = computed
    .filter((f) => f.nextDueDate && Number(f.envelope.targetAmount || 0) > 0)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));

  // Monthly Spending: everyday spending envelopes shown with this month's
  // budget / spent / remaining — no carryover balance, target, or due date.
  const spending = budgetable
    .filter((c) => c.kind === 'spending')
    .map((c) => {
      const budget = effectiveBudgets[c.id] || 0;
      const spent = monthSpent[c.id] || 0;
      return { envelope: c, budget, spent, remaining: budget - spent };
    });
  const spendBudget = spending.reduce((s, e) => s + e.budget, 0);
  const spendSpent = spending.reduce((s, e) => s + e.spent, 0);

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
      <h1 className="page-title">Envelopes</h1>
      <p className="page-intro">
        Your envelopes at a glance. <strong>Sinking funds</strong> carry a balance forward month to month for
        irregular bills; <strong>monthly spending</strong> envelopes reset each month. Create or edit any of them
        on the Budget page.
      </p>

      <h2 className="section-title">Sinking Funds</h2>

      <section className="card">
        <div className="card-header">
          <h2>Across all funds</h2>
        </div>
        <div className="sf-summary sf-summary-grid">
          <div className="sf-summary-figure">
            <span className="sf-summary-label">Saved right now</span>
            <span className="sf-summary-value">{money(totalSaved)}</span>
            <span className="sf-summary-sub">total sitting in your sinking envelopes today</span>
          </div>
          <div className="sf-summary-figure">
            <span className="sf-summary-label">Combined target</span>
            <span className="sf-summary-value">{money(totalTarget)}</span>
            <span className="sf-summary-sub">what the funds with a due-date bill add up to</span>
          </div>
          <div className="sf-summary-figure">
            <span className="sf-summary-label">Catch-up pace</span>
            <span className="sf-summary-value">{money(requiredMonthly)}/mo</span>
            <span className="sf-summary-sub">extra set-aside to make every deadline on time</span>
          </div>
        </div>
        <p className="module-note">
          <strong>Saved right now</strong> is the real cash across all your sinking envelopes — including
          funds you keep topped up with no deadline, which is why it can be higher than the combined target.
          <strong> Combined target</strong> only counts funds that have a target amount and a due date.
          <strong> Catch-up pace</strong> is how much to budget per month, across those dated funds, to have
          each one fully funded by its due date — if it&apos;s $0, you&apos;re on schedule everywhere. Balances
          update automatically as you budget and spend; change a fund&apos;s monthly amount on the Budget page.
        </p>
      </section>

      {upcoming.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2>Upcoming bills</h2>
            <span className="pill">On track to cover each one?</span>
          </div>
          <ul className="sf-upcoming">
            {upcoming.map((f) => {
              const target = Number(f.envelope.targetAmount || 0);
              const pct = target > 0 ? Math.min(100, (f.live / target) * 100) : 0;
              const projPct = target > 0 ? Math.min(100, (f.projected / target) * 100) : 0;
              const ok = f.funded || f.onTrack;
              const badgeText = f.funded ? 'Ready' : f.onTrack ? 'On track' : `Short ${money(f.projectedShort)}`;
              return (
                <li key={f.envelope.id} className="sf-upcoming-row">
                  <div className="sf-upcoming-head">
                    <span className="sf-upcoming-name">{f.envelope.name}</span>
                    <span className={`pill ${ok ? 'pill-good' : 'pill-bad'}`}>{badgeText}</span>
                  </div>
                  <div className="sf-upcoming-due">{dueLabel(f.nextDueDate)}</div>
                  <div className="sf-progress-track bar-track">
                    <div
                      className={`bar-fill ${ok ? 'sf-bar-on-track' : 'sf-bar-behind'}`}
                      style={{ width: `${pct}%` }}
                    />
                    {projPct > pct && (
                      <span
                        className="sf-progress-projected"
                        style={{ left: `${projPct}%` }}
                        title={`Projected ${money(f.projected)} by the due date`}
                      />
                    )}
                  </div>
                  <div className="sf-progress-label">
                    <strong>{money(f.live)}</strong> of {money(target)} saved
                    {!f.funded && f.remaining > 0 && (
                      <> · on pace for <strong>{money(f.projected)}</strong> by then at {money(f.monthly)}/mo</>
                    )}
                  </div>
                  {!ok && (
                    <p className="sf-upcoming-note">
                      At {money(f.monthly)}/mo you&apos;ll be {money(f.projectedShort)} short. Bump this fund to
                      about {money(f.requiredMonthly)}/mo on the Budget page to have it ready in time.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="module-note">
            The bar shows what&apos;s saved now; the marker shows where you&apos;ll land by the due date if you
            keep contributing the budgeted monthly amount. Green means the projection covers the bill.
          </p>
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

      <h2 className="section-title">Monthly Spending</h2>

      <section className="card">
        <div className="card-header">
          <h2>This month</h2>
          <span className="pill">{money(spendSpent)} spent of {money(spendBudget)}</span>
        </div>
        {spending.length === 0 ? (
          <p className="module-note">
            No monthly-spending envelopes yet. On the Budget page, add an envelope and leave its type as
            <strong> Monthly spending</strong>.
          </p>
        ) : (
          <div className="sf-list">
            {spending.map((e) => {
              const pct = e.budget > 0 ? Math.min(100, (e.spent / e.budget) * 100) : 0;
              const over = e.remaining < 0;
              return (
                <div className={`sf-card ${over ? 'sf-card-overdue' : 'sf-card-on-track'}`} key={e.envelope.id}>
                  <div className="sf-card-top">
                    <div className="sf-card-heading">
                      <span className="sf-card-name">{e.envelope.name}</span>
                      <span className={`pill ${over ? 'pill-bad' : 'pill-good'}`}>
                        {over ? `Over ${money(-e.remaining)}` : `${money(e.remaining)} left`}
                      </span>
                    </div>
                  </div>
                  <div className="sf-card-figures">
                    <span className="sf-figure">
                      <span className="sf-figure-label">Budget/mo</span>
                      <span className="sf-figure-value">{money(e.budget)}</span>
                    </span>
                    <span className="sf-figure">
                      <span className="sf-figure-label">Spent</span>
                      <span className="sf-figure-value">{money(e.spent)}</span>
                    </span>
                    <span className="sf-figure">
                      <span className="sf-figure-label">Remaining</span>
                      <span className={`sf-figure-value${over ? ' over-budget' : ''}`}>{money(e.remaining)}</span>
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className={`bar-fill${over ? ' over' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="module-note">
          These reset at the start of each month — this is your budget, what you&apos;ve spent, and what&apos;s
          left. Change amounts on the Budget page.
        </p>
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
