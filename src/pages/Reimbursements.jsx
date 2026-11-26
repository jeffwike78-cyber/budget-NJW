import { useState } from 'react';

// Family Reimbursement ledger. A reimbursable purchase is a short-term IOU, not
// household spending; the payback deposit isn't income. Both are tagged to a
// person (reimburseFrom) and kept out of the budget elsewhere — here they're
// gathered per person so you can see who owes what, mark each purchase
// reimbursed, and keep a record of paybacks received.

function money(n) {
  const v = Number(n || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function TxLine({ t, children }) {
  return (
    <div className="reimb-line">
      <span className="reimb-line-date">{(t.date || '').slice(5)}</span>
      <span className="reimb-line-desc">
        {t.description}
        {t.note && <span className="reimb-line-note">{t.note}</span>}
      </span>
      <span className="reimb-line-amt">{money(Math.abs(Number(t.amount)))}</span>
      <span className="reimb-line-actions">{children}</span>
    </div>
  );
}

export default function Reimbursements({ budgetState, transactions, setReimburseFrom, setReimbursed }) {
  const [busyId, setBusyId] = useState(null);

  const configured = budgetState.reimbursePeople || [];
  // Everything tagged to a person, income (payback) or expense (fronted).
  const tagged = transactions.filter((t) => t.reimburseFrom);
  // People to show = the configured list plus any name that still has activity
  // even if it was later removed from Settings (so nothing goes missing).
  const people = [...new Set([...configured, ...tagged.map((t) => t.reimburseFrom)])];

  async function run(fn) {
    const err = await fn();
    if (err) window.alert(err.message || 'Could not save that change.');
  }
  async function act(id, fn) {
    setBusyId(id);
    try {
      await run(fn);
    } finally {
      setBusyId(null);
    }
  }

  // Build each person's ledger.
  const ledgers = people
    .map((person) => {
      const mine = tagged.filter((t) => t.reimburseFrom === person);
      const expenses = mine.filter((t) => Number(t.amount) > 0);
      const payments = mine.filter((t) => Number(t.amount) < 0);
      const outstanding = expenses.filter((t) => !t.reimbursedAt);
      const settled = expenses.filter((t) => t.reimbursedAt);
      const outstandingTotal = outstanding.reduce((s, t) => s + Number(t.amount), 0);
      const frontedTotal = expenses.reduce((s, t) => s + Number(t.amount), 0);
      const paybackTotal = payments.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      const runningBalance = frontedTotal - paybackTotal;
      return {
        person,
        expenses,
        payments,
        outstanding,
        settled,
        outstandingTotal,
        frontedTotal,
        paybackTotal,
        runningBalance,
        hasActivity: mine.length > 0,
      };
    })
    .sort((a, b) => b.outstandingTotal - a.outstandingTotal);

  const active = ledgers.filter((l) => l.hasActivity);
  const grandOutstanding = active.reduce((s, l) => s + l.outstandingTotal, 0);
  const idle = ledgers.filter((l) => !l.hasActivity).map((l) => l.person);

  // A small person-reassignment dropdown shared by the rows.
  function PersonPicker({ t }) {
    return (
      <select
        className="reimb-person-select"
        value={t.reimburseFrom || ''}
        disabled={busyId === t.id}
        onChange={(e) => act(t.id, () => setReimburseFrom(t.id, e.target.value))}
        title="Change who owes this, or clear the tag"
      >
        {people.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="">Remove tag</option>
      </select>
    );
  }

  return (
    <>
      <h1 className="page-title">Family Reimbursement</h1>
      <p className="page-intro no-print">
        Purchases family members make on your account that they&apos;ll pay back. These are IOUs — they&apos;re kept out
        of your budgeted envelopes and don&apos;t count as income. Tag a charge as “Owed by …” on the Transactions page,
        mark it reimbursed here when it&apos;s paid, and tag the payback deposit as a reimbursement so it stays out of
        income too.
      </p>

      <section className="card reimb-summary">
        <div className="reimb-summary-head">
          <span className="reimb-summary-label">Total owed to you</span>
          <span className={`reimb-summary-value${grandOutstanding > 0.005 ? ' owed' : ''}`}>{money(grandOutstanding)}</span>
        </div>
        {active.length > 0 && (
          <div className="reimb-chips">
            {active.map((l) => (
              <span key={l.person} className={`reimb-chip${l.outstandingTotal > 0.005 ? ' owed' : ''}`}>
                {l.person}: {money(l.outstandingTotal)}
              </span>
            ))}
          </div>
        )}
      </section>

      {active.length === 0 && (
        <p className="module-note">
          Nothing is tagged for reimbursement yet. On the Transactions page, find a purchase a family member owes you
          and use the “Owed by …” tag on its row.
        </p>
      )}

      {active.map((l) => {
        // Cross-check: the per-item outstanding total should match fronted minus
        // paid-back. If they drift, a payback was recorded without marking the
        // item (or vice versa) — flag it gently.
        const mismatch = Math.abs(l.runningBalance - l.outstandingTotal) > 0.01;
        return (
          <section className="card reimb-person" key={l.person}>
            <div className="reimb-person-head">
              <h2 className="reimb-person-name">{l.person}</h2>
              <span className={`reimb-person-owed${l.outstandingTotal > 0.005 ? ' owed' : ''}`}>
                {l.outstandingTotal > 0.005 ? `Owes ${money(l.outstandingTotal)}` : 'All settled'}
              </span>
            </div>

            <p className="reimb-crosscheck">
              Fronted {money(l.frontedTotal)} · paid back {money(l.paybackTotal)} ·{' '}
              <strong>net {money(l.runningBalance)}</strong>
              {mismatch && (
                <span className="reimb-crosscheck-warn">
                  {' '}
                  ⚠ doesn&apos;t match the {money(l.outstandingTotal)} of unmarked items — mark items reimbursed, or tag
                  the matching payback deposit.
                </span>
              )}
            </p>

            {l.outstanding.length > 0 && (
              <div className="reimb-group">
                <div className="reimb-group-title">Outstanding</div>
                {l.outstanding.map((t) => (
                  <TxLine key={t.id} t={t}>
                    <button
                      type="button"
                      className="secondary-btn reimb-btn"
                      disabled={busyId === t.id}
                      onClick={() => act(t.id, () => setReimbursed(t.id, true))}
                    >
                      ✓ Mark reimbursed
                    </button>
                    <PersonPicker t={t} />
                  </TxLine>
                ))}
              </div>
            )}

            {l.payments.length > 0 && (
              <div className="reimb-group">
                <div className="reimb-group-title">Paybacks received</div>
                {l.payments.map((t) => (
                  <TxLine key={t.id} t={t}>
                    <span className="reimb-paid-tag">received</span>
                    <PersonPicker t={t} />
                  </TxLine>
                ))}
              </div>
            )}

            {l.settled.length > 0 && (
              <details className="reimb-history">
                <summary>
                  Reimbursed history ({l.settled.length}) · {money(l.settled.reduce((s, t) => s + Number(t.amount), 0))}
                </summary>
                {l.settled.map((t) => (
                  <TxLine key={t.id} t={t}>
                    <span className="reimb-paid-tag done">reimbursed {String(t.reimbursedAt).slice(0, 10)}</span>
                    <button
                      type="button"
                      className="link-btn reimb-btn"
                      disabled={busyId === t.id}
                      onClick={() => act(t.id, () => setReimbursed(t.id, false))}
                    >
                      Reopen
                    </button>
                  </TxLine>
                ))}
              </details>
            )}
          </section>
        );
      })}

      {idle.length > 0 && (
        <p className="module-note reimb-idle">Nothing outstanding for: {idle.join(', ')}.</p>
      )}
    </>
  );
}
