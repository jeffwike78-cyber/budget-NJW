import { useState } from 'react';
import { todayStr } from '../lib/storage';
import { netSpentByCategory } from '../lib/spending';
import { monthlyIncomeTotal, computeCategoryBudgets, effectiveBudgetsForMonth, envelopeBalances, adjustmentMaps, isCarryover, signedBalance, includeInCashOnHand } from '../lib/budgetMath';
import { computeSinkingEnvelope, advanceDueDate, dueLabel } from '../lib/sinkingFunds';
import TxList from '../components/TxList';

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
export default function SinkingFunds({ budgetState, setBudgetState, transactions, recategorize, splitTransaction, setExcluded, setTaxCategory }) {
  const [showBills, setShowBills] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [move, setMove] = useState({ from: '', to: '', amount: '', note: '' });
  const [moveMsg, setMoveMsg] = useState(null);
  // Which envelope cards have their transaction list expanded.
  const [expandedTx, setExpandedTx] = useState(() => new Set());
  const month = monthKey();
  const income = monthlyIncomeTotal(budgetState);
  const budgetable = (budgetState.categories || []).filter((c) => c.id !== 'needs-review');
  const baseBudgets = computeCategoryBudgets(budgetable, income);
  const effectiveBudgets = effectiveBudgetsForMonth(budgetable, baseBudgets, month);
  const allTimeSpent = netSpentByCategory(transactions);
  const monthTx = transactions.filter((t) => monthKey(t.date) === month);
  const monthSpent = netSpentByCategory(monthTx);
  const { all: adjustAll, month: adjustMonth } = adjustmentMaps(budgetState.adjustments, month);
  const balances = envelopeBalances(budgetable, baseBudgets, allTimeSpent, monthSpent, budgetState.settings?.startMonth, month, adjustAll, adjustMonth);

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
    // The status the card shows is projection-aware — it reflects whether the
    // CURRENT monthly set-aside will fund the target by the due date. So raising
    // the monthly amount to (or above) the recommended figure flips it off
    // "behind" the moment it's enough, instead of judging only past balance.
    const displayStatus = base.funded ? 'funded' : base.overdue ? 'overdue' : onTrack ? 'on-track' : 'behind';
    const recommendedMonthly = Math.ceil(base.requiredMonthly || 0);
    return { envelope: c, live, monthly, projected, onTrack, projectedShort, displayStatus, recommendedMonthly, ...base };
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

  // Reconciliation: the money "assigned" to carryover envelopes (sinking +
  // spending + transfer keep a running balance; bills reset monthly and don't)
  // should be backed by real cash sitting in checking + savings. If assigned
  // exceeds cash on hand, some envelopes are funded on paper but not with actual
  // dollars yet — the usual cause of "how is $6k in envelopes when checking is
  // $3k?".
  const assigned = budgetable
    .filter((c) => isCarryover(c.kind))
    .reduce((s, c) => s + (balances[c.id]?.available ?? 0), 0);
  const cashOnHand = (budgetState.accounts || [])
    .filter(includeInCashOnHand)
    .reduce((s, a) => s + signedBalance(a), 0);
  const reconcileDiff = assigned - cashOnHand;
  const overAssigned = reconcileDiff > 1;

  // A page-specific display order (settings.envelopeOrder) that's independent of
  // the Budget page — so the most-used envelopes can sit at the top here without
  // moving anything on the Budget. Anything not yet in the list sorts to the end
  // in its natural order.
  const order = budgetState.settings?.envelopeOrder || [];
  const rank = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const byOrder = (a, b) => rank(a.envelope.id) - rank(b.envelope.id);
  const computedSorted = [...computed].sort(byOrder);
  const spendingSorted = [...spending].sort(byOrder);
  const sinkingIds = computedSorted.map((f) => f.envelope.id);
  const spendingIds = spendingSorted.map((e) => e.envelope.id);

  function persistEnvelopeOrder(sinkIds, spendIds) {
    setBudgetState((prev) => ({
      ...prev,
      settings: { ...(prev.settings || {}), envelopeOrder: [...sinkIds, ...spendIds] },
    }));
  }
  function swapped(ids, id, dir) {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  function moveSinking(id, dir) {
    const next = swapped(sinkingIds, id, dir);
    if (next) persistEnvelopeOrder(next, spendingIds);
  }
  function moveSpending(id, dir) {
    const next = swapped(spendingIds, id, dir);
    if (next) persistEnvelopeOrder(sinkingIds, next);
  }

  function updateFund(id, patch) {
    setBudgetState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  function toggleTx(id) {
    setExpandedTx((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Recategorizing from the drill-down also teaches the AI (merchantMemory), so
  // future transactions from the same merchant file themselves — same behavior
  // as the Budget page's inline list.
  async function handleRecategorize(txId, categoryId) {
    const tx = transactions.find((t) => t.id === txId);
    await recategorize(txId, categoryId);
    if (tx) {
      const key = tx.description.trim().toLowerCase();
      setBudgetState((prev) => ({ ...prev, merchantMemory: { ...prev.merchantMemory, [key]: categoryId } }));
    }
  }

  const txListProps = {
    categories: budgetState.categories,
    incomeCategories: budgetState.incomeCategories,
    onRecategorize: handleRecategorize,
    onSplit: splitTransaction,
    onToggleExcluded: setExcluded,
    onSetTaxCategory: setTaxCategory,
    taxLabels: budgetState.taxLabels,
  };

  // The expandable "this month's transactions" drill-down for one envelope,
  // reused by both spending and sinking cards. Editing a category inline here
  // updates the transaction in place (and teaches the AI).
  function renderEnvelopeTx(envId) {
    const tx = monthTx.filter((t) => t.categoryId === envId);
    const open = expandedTx.has(envId);
    return (
      <div className="sf-tx-drill">
        <button type="button" className="category-expand-toggle" onClick={() => toggleTx(envId)}>
          {open ? 'Hide' : 'Show'} transactions{tx.length ? ` (${tx.length})` : ''} {open ? '▴' : '▾'}
        </button>
        {open &&
          (tx.length > 0 ? (
            <TxList transactions={tx} {...txListProps} />
          ) : (
            <p className="module-note">No transactions in this envelope this month.</p>
          ))}
      </div>
    );
  }

  function markPaid(f) {
    // The payment itself is a transaction against this envelope (that's what
    // draws the balance down); marking paid just rolls the due date forward.
    updateFund(f.envelope.id, { nextDueDate: advanceDueDate(f.nextDueDate, f.envelope.frequency) });
  }

  const nameOf = (id) => budgetable.find((c) => c.id === id)?.name || 'an envelope';

  // Record a manual money move. "To" gets +amount; if a "From" envelope is
  // chosen, it gets −amount (a true transfer, cash-neutral). With no "From",
  // it's a top-up from cash you already hold. Both legs share a moveId so the
  // pair can be undone together.
  function submitMove(e) {
    e.preventDefault();
    setMoveMsg(null);
    const amount = Number(move.amount);
    if (!move.to) return setMoveMsg('Pick an envelope to move money into.');
    if (!(amount > 0)) return setMoveMsg('Enter an amount greater than zero.');
    if (move.from && move.from === move.to) return setMoveMsg('Pick two different envelopes.');
    const moveId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const entries = [
      { id: crypto.randomUUID(), moveId, month, categoryId: move.to, amount, note: move.note?.trim() || null, from: move.from || null, createdAt: stamp },
    ];
    if (move.from) {
      entries.push({ id: crypto.randomUUID(), moveId, month, categoryId: move.from, amount: -amount, note: move.note?.trim() || null, from: null, createdAt: stamp });
    }
    setBudgetState((prev) => ({ ...prev, adjustments: [...(prev.adjustments || []), ...entries] }));
    setMoveMsg(
      move.from
        ? `Moved ${money(amount)} from ${nameOf(move.from)} to ${nameOf(move.to)} ✓`
        : `Added ${money(amount)} to ${nameOf(move.to)} ✓`
    );
    setMove({ from: '', to: '', amount: '', note: '' });
  }

  function undoMove(moveId) {
    setBudgetState((prev) => ({ ...prev, adjustments: (prev.adjustments || []).filter((a) => a.moveId !== moveId) }));
  }

  // Recent moves, newest first, grouped by moveId so a transfer shows as one row.
  const moveLog = [];
  const seen = new Set();
  for (const a of [...(budgetState.adjustments || [])].reverse()) {
    if (seen.has(a.moveId)) continue;
    seen.add(a.moveId);
    const legs = (budgetState.adjustments || []).filter((x) => x.moveId === a.moveId);
    const into = legs.find((x) => x.amount > 0);
    const outOf = legs.find((x) => x.amount < 0);
    moveLog.push({ moveId: a.moveId, into, outOf, note: a.note, createdAt: a.createdAt });
  }

  return (
    <>
      <h1 className="page-title">Envelopes</h1>
      <p className="page-intro">
        Your envelopes at a glance. <strong>Sinking funds</strong> carry a balance forward month to month for
        irregular bills; <strong>monthly spending</strong> envelopes reset each month. Create or edit any of them
        on the Budget page.
      </p>

      <section className={`card reconcile-banner ${overAssigned ? 'reconcile-warn' : 'reconcile-ok'}`}>
        <div className="reconcile-row">
          <div className="reconcile-fig">
            <span className="reconcile-label">Assigned to envelopes</span>
            <span className="reconcile-value">{money(assigned)}</span>
          </div>
          <span className="reconcile-op">vs</span>
          <div className="reconcile-fig">
            <span className="reconcile-label">Cash on hand</span>
            <span className="reconcile-value">{money(cashOnHand)}</span>
            <span className="reconcile-sub">included accounts — choose which in Accounts</span>
          </div>
          <span className={`pill ${overAssigned ? 'pill-bad' : 'pill-good'}`}>
            {overAssigned ? `Over-assigned ${money(reconcileDiff)}` : `${money(-reconcileDiff)} unassigned`}
          </span>
        </div>
        <p className="module-note">
          {overAssigned ? (
            <>
              Your envelopes hold <strong>{money(reconcileDiff)}</strong> more than your accounts actually contain —
              that much is set aside on paper but isn&apos;t backed by real cash yet. Lower some opening balances or
              monthly set-asides, or move cash into checking/savings, until these two line up. (Envelope balances are
              an accounting overlay — assigning money doesn&apos;t move it; it just earmarks cash you already have.)
            </>
          ) : (
            <>
              Your checking + savings cover everything you&apos;ve set aside, with <strong>{money(-reconcileDiff)}</strong>{' '}
              not yet assigned to an envelope. Envelope balances are money earmarked from the cash you already hold —
              this is how it should look.
            </>
          )}
        </p>
      </section>

      <section className="card">
        <button type="button" className="tx-section-toggle" onClick={() => setShowMove((s) => !s)} aria-expanded={showMove}>
          <span>Move money</span>
          <span className="tx-section-count">Cover an overspend · top up a fund {showMove ? '▴' : '▾'}</span>
        </button>
        {showMove && (
        <>
        <p className="module-note">
          Shuffle money between envelopes without it counting as spending or income. Moving <em>from</em> one
          envelope <em>to</em> another is cash-neutral (great for covering an over-budget envelope from one with
          room). Leave <strong>From</strong> blank to add cash you already hold into an envelope.
        </p>
        <form className="move-form" onSubmit={submitMove}>
          <label className="move-field">
            <span>From (optional)</span>
            <select value={move.from} onChange={(e) => setMove((m) => ({ ...m, from: e.target.value }))}>
              <option value="">— cash on hand —</option>
              {budgetable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="move-field">
            <span>To</span>
            <select value={move.to} onChange={(e) => setMove((m) => ({ ...m, to: e.target.value }))}>
              <option value="" disabled>Choose envelope…</option>
              {budgetable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="move-field">
            <span>Amount</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="$"
              value={move.amount}
              onChange={(e) => setMove((m) => ({ ...m, amount: e.target.value }))}
            />
          </label>
          <label className="move-field move-field-wide">
            <span>Note (optional)</span>
            <input
              type="text"
              placeholder="e.g. cover August life insurance"
              value={move.note}
              onChange={(e) => setMove((m) => ({ ...m, note: e.target.value }))}
            />
          </label>
          <button type="submit" className="primary-btn">Move</button>
        </form>
        {moveMsg && <p className="module-note form-ok" role="status">{moveMsg}</p>}
        {moveLog.length > 0 && (
          <div className="move-log">
            <div className="move-log-title">Recent moves</div>
            <ul>
              {moveLog.slice(0, 8).map((mv) => (
                <li key={mv.moveId} className="move-log-row">
                  <span className="move-log-desc">
                    {mv.outOf ? (
                      <>
                        {money(mv.into?.amount || 0)}: <strong>{nameOf(mv.outOf.categoryId)}</strong> → <strong>{nameOf(mv.into?.categoryId)}</strong>
                      </>
                    ) : (
                      <>
                        {money(mv.into?.amount || 0)} into <strong>{nameOf(mv.into?.categoryId)}</strong> <span className="move-log-src">(from cash)</span>
                      </>
                    )}
                    {mv.note && <span className="move-log-note"> · {mv.note}</span>}
                  </span>
                  <button type="button" className="link-btn danger" onClick={() => undoMove(mv.moveId)}>Undo</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        </>
        )}
      </section>

      <h2 className="section-title">Monthly Spending</h2>

      <section className="card">
        <div className="card-header">
          <h2>This month</h2>
          <span className="pill">{money(spendSpent)} spent of {money(spendBudget)}</span>
        </div>
        {spendingSorted.length === 0 ? (
          <p className="module-note">
            No monthly-spending envelopes yet. On the Budget page, add an envelope and leave its type as
            <strong> Monthly spending</strong>.
          </p>
        ) : (
          <div className="sf-list">
            {spendingSorted.map((e, i) => {
              const pct = e.budget > 0 ? Math.min(100, (e.spent / e.budget) * 100) : 0;
              const over = e.remaining < 0;
              return (
                <div className={`sf-card ${over ? 'sf-card-overdue' : 'sf-card-on-track'}`} key={e.envelope.id}>
                  <div className="sf-card-top">
                    <div className="sf-card-heading">
                      <Reorder
                        onUp={() => moveSpending(e.envelope.id, -1)}
                        onDown={() => moveSpending(e.envelope.id, 1)}
                        first={i === 0}
                        last={i === spendingSorted.length - 1}
                      />
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
                  {renderEnvelopeTx(e.envelope.id)}
                </div>
              );
            })}
          </div>
        )}
        <p className="module-note">
          These reset at the start of each month — this is your budget, what you&apos;ve spent, and what&apos;s
          left. Change amounts on the Budget page. Use the arrows to move the ones you check most to the top.
        </p>
      </section>

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
            <button
              type="button"
              className="cashflow-toggle"
              onClick={() => setShowBills((s) => !s)}
              aria-expanded={showBills}
            >
              {showBills ? 'Hide' : 'Show'} ({upcoming.length}) {showBills ? '▴' : '▾'}
            </button>
          </div>
          {showBills && (
          <>
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
                      At {money(f.monthly)}/mo you&apos;ll be {money(f.projectedShort)} short. Set this fund to
                      {' '}{money(f.recommendedMonthly)}/mo on the Budget page and this clears.
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
          </>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Your funds</h2>
          {computedSorted.length > 1 && <span className="pill">↕ Reorder with the arrows</span>}
        </div>
        {computedSorted.length === 0 ? (
          <p className="module-note">
            No sinking funds yet. On the Budget page, add an envelope and set its type to
            <strong> Sinking fund</strong>.
          </p>
        ) : (
          <div className="sf-list">
            {computedSorted.map((f, i) => (
              <FundCard
                key={f.envelope.id}
                f={f}
                onUpdate={updateFund}
                onMarkPaid={markPaid}
                onMoveUp={() => moveSinking(f.envelope.id, -1)}
                onMoveDown={() => moveSinking(f.envelope.id, 1)}
                isFirst={i === 0}
                isLast={i === computedSorted.length - 1}
                renderTx={renderEnvelopeTx}
              />
            ))}
          </div>
        )}
      </section>

    </>
  );
}

function Reorder({ onUp, onDown, first, last }) {
  return (
    <div className="sf-reorder">
      <button type="button" className="reorder-btn" aria-label="Move up" disabled={first} onClick={onUp}>
        ↑
      </button>
      <button type="button" className="reorder-btn" aria-label="Move down" disabled={last} onClick={onDown}>
        ↓
      </button>
    </div>
  );
}

function FundCard({ f, onUpdate, onMarkPaid, onMoveUp, onMoveDown, isFirst, isLast, renderTx }) {
  const [expanded, setExpanded] = useState(false);
  const env = f.envelope;
  const hasTarget = Number(env.targetAmount || 0) > 0;
  const status = f.displayStatus;

  return (
    <div className={`sf-card sf-card-${status}`}>
      <div className="sf-card-top">
        <div className="sf-card-heading">
          <Reorder onUp={onMoveUp} onDown={onMoveDown} first={isFirst} last={isLast} />
          <span className="sf-card-name">{env.name}</span>
          {hasTarget && <span className={`pill ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>}
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
          <div className={`bar-fill sf-bar-${status}`} style={{ width: `${f.pct}%` }} />
        </div>
      )}

      {status === 'behind' && (
        <p className="sf-warn">
          At {money(f.monthly)}/mo you&apos;re on pace for {money(f.projected)} by {dueLabel(env.nextDueDate)} —
          {' '}{money(f.projectedShort)} short. Set this fund to {money(f.recommendedMonthly)}/mo on the Budget
          page and this clears automatically.
        </p>
      )}
      {status === 'on-track' && hasTarget && !f.funded && (
        <p className="sf-warn sf-warn-good">
          On pace — {money(f.monthly)}/mo reaches {money(f.projected)} by {dueLabel(env.nextDueDate)}, covering
          the {money(env.targetAmount)} bill.
        </p>
      )}
      {status === 'overdue' && !f.funded && (
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

      {renderTx && renderTx(env.id)}
    </div>
  );
}
