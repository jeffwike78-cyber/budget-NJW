import { signedBalance } from './budgetMath';

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The next calendar date a given day-of-month lands on, on or after today.
// Clamps to the last day of short months (e.g. a 31st due day → Feb 28).
export function nextOccurrence(day, today = new Date()) {
  const t0 = startOfDay(today);
  const cursor = new Date(t0.getFullYear(), t0.getMonth(), 1);
  for (let i = 0; i < 3; i++) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    const cand = new Date(y, m, Math.min(day, last));
    if (cand >= t0) return cand;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return t0;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

// Everything the UI needs about the everyday credit card's cycle. Returns
// { configured:false } until the user picks a card and days on the Accounts page.
export function creditCardStatus(settings, accounts = [], today = new Date()) {
  const cc = settings?.creditCard;
  if (!cc || !cc.accountId || !cc.dueDay) return { configured: false };
  const account = (accounts || []).find((a) => a.id === cc.accountId) || null;

  const dueDate = nextOccurrence(Number(cc.dueDay), today);
  const daysUntilDue = daysBetween(dueDate, today);
  const statementDate = cc.statementDay ? nextOccurrence(Number(cc.statementDay), today) : null;
  const daysUntilStatement = statementDate ? daysBetween(statementDate, today) : null;

  // Credit balances are stored as a positive amount owed; that's the payoff.
  const balance = account ? Math.abs(signedBalance(account)) : null;

  return {
    configured: true,
    account,
    accountName: account?.name || 'Credit card',
    dueDay: Number(cc.dueDay),
    statementDay: cc.statementDay ? Number(cc.statementDay) : null,
    dueDate,
    daysUntilDue,
    statementDate,
    daysUntilStatement,
    balance,
    dueSoon: daysUntilDue <= 7,
  };
}

export function formatDueDate(d) {
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
