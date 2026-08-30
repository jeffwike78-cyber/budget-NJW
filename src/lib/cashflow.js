// Projects money in and money out over the coming weeks so you can see whether
// checking covers what's due before the next paycheck lands. Income comes from
// each source's pay date + cadence; outflows come from bills that have a due
// day and from sinking funds on their due date.
import { todayStr } from './storage';

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parse(str) {
  return new Date(str + 'T00:00:00');
}

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// Advance a date by one cadence step. Semimonthly is treated as ~twice a month.
function advance(d, frequency) {
  const n = new Date(d);
  switch (frequency) {
    case 'weekly': n.setDate(n.getDate() + 7); break;
    case 'biweekly': n.setDate(n.getDate() + 14); break;
    case 'semimonthly': n.setDate(n.getDate() + 15); break;
    case 'quarterly': n.setMonth(n.getMonth() + 3); break;
    case 'annual': n.setFullYear(n.getFullYear() + 1); break;
    default: n.setMonth(n.getMonth() + 1); break; // monthly
  }
  return n;
}

// Income landing events between two dates (inclusive), one per pay occurrence.
export function incomeEvents(sources, fromStr, toStr) {
  const from = parse(fromStr);
  const to = parse(toStr);
  const events = [];
  for (const s of sources || []) {
    const amount = Number(s.amount || 0);
    if (!amount || !s.payDate) continue;
    if (s.frequency === 'one-time') {
      const d = parse(s.payDate);
      if (d >= from && d <= to) events.push({ date: s.payDate, name: s.name, amount, kind: 'income' });
      continue;
    }
    let d = parse(s.payDate);
    let guard = 0;
    while (d < from && guard < 1000) { d = advance(d, s.frequency); guard += 1; }
    while (d <= to && guard < 2000) {
      events.push({ date: iso(d), name: s.name, amount, kind: 'income' });
      d = advance(d, s.frequency);
      guard += 1;
    }
  }
  return events;
}

// Bill outflows: bill-kind envelopes that have a due day, one per month in range.
export function billEvents(categories, effectiveBudgets, fromStr, toStr) {
  const from = parse(fromStr);
  const to = parse(toStr);
  const events = [];
  for (const c of categories || []) {
    if (c.kind !== 'bill') continue;
    const amount = Number(effectiveBudgets[c.id] || 0);
    const day = Number(c.dueDay || 0);
    if (!amount || !day) continue;
    // Walk month by month from the start month through the end month.
    let y = from.getFullYear();
    let m = from.getMonth();
    let guard = 0;
    while (guard < 60) {
      const dd = Math.min(day, daysInMonth(y, m));
      const d = new Date(y, m, dd);
      if (d > to) break;
      if (d >= from) events.push({ date: iso(d), name: c.name, amount: -amount, kind: 'bill' });
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      guard += 1;
    }
  }
  return events;
}

// Sinking-fund payouts: each fund's target on its due date, if it falls in range.
export function sinkingEvents(funds, fromStr, toStr) {
  const from = parse(fromStr);
  const to = parse(toStr);
  const events = [];
  for (const f of funds || []) {
    if (!f.nextDueDate) continue;
    const d = parse(f.nextDueDate);
    const amount = Number(f.targetAmount || 0);
    if (!amount) continue;
    if (d >= from && d <= to) events.push({ date: f.nextDueDate, name: f.name, amount: -amount, kind: 'sinking' });
  }
  return events;
}

// Build the full timeline: every event sorted by date with a running balance,
// starting from `startingBalance`. Also reports the lowest point it reaches.
export function projectCashflow({ startingBalance, sources, categories, effectiveBudgets, sinkingFunds, days = 60, fromStr = todayStr() }) {
  const from = parse(fromStr);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  const toStr = iso(to);

  const events = [
    ...incomeEvents(sources, fromStr, toStr),
    ...billEvents(categories, effectiveBudgets, fromStr, toStr),
    ...sinkingEvents(sinkingFunds, fromStr, toStr),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = Number(startingBalance || 0);
  let low = running;
  let lowDate = fromStr;
  const timeline = events.map((e) => {
    running += e.amount;
    if (running < low) { low = running; lowDate = e.date; }
    return { ...e, balance: running };
  });

  return { timeline, endingBalance: running, low, lowDate, toStr };
}
