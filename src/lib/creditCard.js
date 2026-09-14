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

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// Reads like a payment TO the card, not a purchase or a refund. Autopay posts
// as "AUTOMATIC PAYMENT - THANK YOU", "Payment Thank You", "ONLINE PMT", etc.
const CARD_PAYMENT_RE = /payment|autopay|auto\s?pay|thank\s?you|e-?pay|online pmt|bill\s?pay|ach\b/i;

// Has the payment for the current statement cycle already gone through? With
// autopay the payment lands on/near the due date, so look for a credit to the
// card (a negative amount reduces the balance owed) that reads like a payment,
// dated in a window bracketing this cycle's due date. A window keeps last
// month's payment (~30 days earlier) from counting for this cycle. Returns the
// matched payment { date: Date, amount } (amount as positive dollars) or null.
export function findCardPayment(accountId, dueDate, transactions = [], today = new Date()) {
  if (!accountId || !dueDate) return null;
  const windowStart = addDays(dueDate, -14);
  const windowEnd = addDays(dueDate, 5);
  const t0 = startOfDay(today);
  let best = null;
  for (const t of transactions) {
    if (t.accountId !== accountId) continue;
    if (!(Number(t.amount) < 0)) continue; // a credit to the card
    if (!CARD_PAYMENT_RE.test(String(t.description || ''))) continue;
    const d = startOfDay(new Date(`${t.date}T00:00:00`));
    if (Number.isNaN(d.getTime())) continue;
    if (d < startOfDay(windowStart) || d > startOfDay(windowEnd) || d > t0) continue;
    // Prefer the most recent qualifying payment in the window.
    if (!best || d > best.date) best = { date: d, amount: Math.abs(Number(t.amount)) };
  }
  return best;
}

// Everything the UI needs about the everyday credit card's cycle. Returns
// { configured:false } until the user picks a card and days on the Accounts page.
export function creditCardStatus(settings, accounts = [], transactions = [], today = new Date()) {
  const cc = settings?.creditCard;
  if (!cc || !cc.accountId || !cc.dueDay) return { configured: false };
  const account = (accounts || []).find((a) => a.id === cc.accountId) || null;

  const dueDate = nextOccurrence(Number(cc.dueDay), today);
  const daysUntilDue = daysBetween(dueDate, today);
  const statementDate = cc.statementDay ? nextOccurrence(Number(cc.statementDay), today) : null;
  const daysUntilStatement = statementDate ? daysBetween(statementDate, today) : null;

  // Credit balances are stored as a positive amount owed; that's the payoff.
  const balance = account ? Math.abs(signedBalance(account)) : null;

  // Has this cycle's payment already posted (e.g. autopay)? If so the Overview
  // shows "paid" instead of nagging that it's due.
  const paid = findCardPayment(cc.accountId, dueDate, transactions, today);

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
    paid,
  };
}

export function formatDueDate(d) {
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
