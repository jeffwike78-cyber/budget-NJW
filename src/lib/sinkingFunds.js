// ---------------------------------------------------------------------------
// Sinking-fund math — the "envelope for irregular bills" engine.
//
// A sinking fund is a pot of money you fill a little each month so that a big
// occasional bill (auto insurance, the December mortgage payment, vacation…)
// is already paid for when it lands. The core job here is to answer two
// questions for each fund:
//
//   1. How much should I set aside THIS month to be ready in time?
//   2. Am I on track, or am I going to come up short?
// ---------------------------------------------------------------------------
import { todayStr } from './storage';

const PERIOD_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

export function periodMonths(frequency) {
  return PERIOD_MONTHS[frequency] || 12;
}

export function daysUntil(dueDateStr, fromStr = todayStr()) {
  if (!dueDateStr) return null;
  const due = new Date(dueDateStr + 'T00:00:00');
  const from = new Date(fromStr + 'T00:00:00');
  return Math.round((due - from) / 86400000);
}

// How many monthly deposits you can still make before the due date (at least 1
// while it's in the future). Rounded up: a bill ~40 days out still gives you
// two chances to add money, not one.
export function contributionsRemaining(dueDateStr, fromStr = todayStr()) {
  const days = daysUntil(dueDateStr, fromStr);
  if (days == null) return null;
  if (days <= 0) return 0;
  return Math.max(1, Math.ceil(days / 30.44));
}

// The heart of it: given a fund's target, current balance, and due date,
// work out the monthly set-aside needed and whether it's on track.
export function computeFund(fund, fromStr = todayStr()) {
  const target = Number(fund.targetAmount || 0);
  const balance = Number(fund.balance || 0);
  const days = daysUntil(fund.nextDueDate, fromStr);
  const remaining = contributionsRemaining(fund.nextDueDate, fromStr);
  const ideal = target / periodMonths(fund.frequency); // steady-state monthly pace
  const stillNeeded = Math.max(0, target - balance);

  let requiredMonthly;
  if (stillNeeded === 0) requiredMonthly = 0;
  else if (remaining && remaining > 0) requiredMonthly = stillNeeded / remaining;
  else requiredMonthly = stillNeeded; // due now / overdue — you need the whole rest

  const funded = target > 0 && balance >= target;
  const overdue = days != null && days < 0 && !funded;
  const dueSoon = days != null && days >= 0 && days <= 31;
  // "Behind" = catching up now costs meaningfully more than the normal pace.
  const behind = !funded && !overdue && requiredMonthly > ideal * 1.05;

  let status;
  if (funded) status = 'funded';
  else if (overdue) status = 'overdue';
  else if (behind) status = 'behind';
  else status = 'on-track';

  const pct = target > 0 ? Math.min(100, (balance / target) * 100) : 0;

  return {
    ...fund,
    target,
    balance,
    days,
    remaining,
    ideal,
    requiredMonthly,
    stillNeeded,
    funded,
    overdue,
    dueSoon,
    behind,
    status,
    pct,
  };
}

// Roll a due date forward one period — used when a bill is marked paid.
export function advanceDueDate(dueDateStr, frequency) {
  const d = new Date((dueDateStr || todayStr()) + 'T00:00:00');
  d.setMonth(d.getMonth() + periodMonths(frequency));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Total you should be setting aside across all funds this month.
export function totalRequiredMonthly(funds, fromStr = todayStr()) {
  return funds.reduce((sum, f) => sum + computeFund(f, fromStr).requiredMonthly, 0);
}

// Human-friendly due-date text, e.g. "Dec 13, 2026 · in 3 months" or "overdue".
export function dueLabel(dueDateStr, fromStr = todayStr()) {
  if (!dueDateStr) return 'no due date set';
  const due = new Date(dueDateStr + 'T00:00:00');
  const dateText = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const days = daysUntil(dueDateStr, fromStr);
  if (days == null) return dateText;
  if (days < 0) return `${dateText} · overdue`;
  if (days === 0) return `${dateText} · due today`;
  if (days < 45) return `${dateText} · in ${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.44);
  return `${dateText} · in ${months} month${months === 1 ? '' : 's'}`;
}
