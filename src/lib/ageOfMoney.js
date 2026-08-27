import { daysBetween } from './storage';

// "Age of Money" (a.k.a. days of buffer): how many days old your dollars are
// when you spend them. Higher = you're living on income earned longer ago, so a
// bad month can't knock you over. 45+ is the goal.
//
// Method (FIFO, YNAB-style): line up money-in as a queue of dollars by date;
// each dollar spent is matched against the oldest unspent income dollars, and
// its "age" is how many days those dollars sat first. The metric is the average
// age of the most recent `window` outflows.
function isHouseholdSpend(t) {
  return (
    Number(t.amount) > 0 &&
    !t.excluded &&
    !t.business &&
    t.taxCategory !== 'business-1' &&
    t.taxCategory !== 'business-2'
  );
}

export function ageOfMoney(transactions, { window = 10 } = {}) {
  const txs = [...transactions].filter((t) => !t.excluded).sort((a, b) => a.date.localeCompare(b.date));

  const inflows = []; // FIFO queue of { date, remaining }
  const outflowAges = [];

  for (const t of txs) {
    const amt = Number(t.amount);
    if (amt < 0) {
      inflows.push({ date: t.date, remaining: -amt }); // money in
    } else if (isHouseholdSpend(t)) {
      let need = amt;
      let weightedDays = 0;
      let consumed = 0;
      while (need > 0 && inflows.length > 0) {
        const src = inflows[0];
        const take = Math.min(need, src.remaining);
        weightedDays += daysBetween(src.date, t.date) * take;
        consumed += take;
        need -= take;
        src.remaining -= take;
        if (src.remaining <= 0.0001) inflows.shift();
      }
      if (consumed > 0) outflowAges.push(weightedDays / consumed);
    }
  }

  const recent = outflowAges.slice(-window);
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((s, a) => s + a, 0) / recent.length);
}

export function ageOfMoneyAdvice(age) {
  if (age == null) return 'Not enough history yet — it builds as income and spending accumulate.';
  if (age >= 45) return 'On target. You’re spending money you earned over 45 days ago — a full month of cushion.';
  if (age >= 30) return 'Close to the 45-day goal. Fund next month fully before you spend this month to push it higher.';
  return 'Below goal. Spend less than you earn and let the surplus age — aim to pay this month’s bills from last month’s income.';
}

export function ageOfMoneyStatus(age) {
  if (age == null) return 'neutral';
  if (age >= 45) return 'good';
  if (age >= 30) return 'warn';
  return 'bad';
}
