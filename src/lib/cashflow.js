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

// Roll a single anchor date forward by `stepFreq` across the window.
function seriesFrom(anchorStr, stepFreq, from, to, push) {
  let d = parse(anchorStr);
  let guard = 0;
  while (d < from && guard < 1000) { d = advance(d, stepFreq); guard += 1; }
  while (d <= to && guard < 2000) { push(iso(d)); d = advance(d, stepFreq); guard += 1; }
}

// Emit an event on a given day-of-month every month in range, clamped to the
// month's length (so "31" lands on the 30th/28th where needed).
function monthlyOnDay(day, from, to, push) {
  const d0 = Number(day);
  if (!(d0 >= 1 && d0 <= 31)) return;
  let y = from.getFullYear();
  let m = from.getMonth();
  let guard = 0;
  while (guard < 60) {
    const d = new Date(y, m, Math.min(d0, daysInMonth(y, m)));
    if (d > to) break;
    if (d >= from) push(iso(d));
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    guard += 1;
  }
}

// Income landing events between two dates (inclusive), one per pay occurrence.
// Monthly / twice-a-month income repeats on a day-of-month so it never expires;
// weekly/biweekly/quarterly/annual use an anchor date they step forward from.
export function incomeEvents(sources, fromStr, toStr) {
  const from = parse(fromStr);
  const to = parse(toStr);
  const events = [];
  for (const s of sources || []) {
    const amount = Number(s.amount || 0);
    if (!amount) continue;
    const add = (dateStr) => events.push({ date: dateStr, name: s.name, amount, kind: 'income' });

    if (s.frequency === 'monthly') {
      if (s.payDay) monthlyOnDay(s.payDay, from, to, add);
      else if (s.payDate) seriesFrom(s.payDate, 'monthly', from, to, add); // legacy
      continue;
    }
    if (s.frequency === 'semimonthly') {
      if (s.payDay || s.payDay2) {
        if (s.payDay) monthlyOnDay(s.payDay, from, to, add);
        if (s.payDay2) monthlyOnDay(s.payDay2, from, to, add);
      } else if (s.payDate) {
        seriesFrom(s.payDate, 'monthly', from, to, add); // legacy dates
        if (s.payDate2) seriesFrom(s.payDate2, 'monthly', from, to, add);
      }
      continue;
    }
    // Weekly / biweekly / quarterly / annual / one-time need an anchor date.
    if (!s.payDate) continue;
    if (s.frequency === 'one-time') {
      const d = parse(s.payDate);
      if (d >= from && d <= to) add(s.payDate);
      continue;
    }
    seriesFrom(s.payDate, s.frequency, from, to, add);
  }
  return events;
}

// Parse a bill's due day(s): a string like "1, 15" or a legacy single number.
function billDueDays(c) {
  const raw = c.dueDays != null ? String(c.dueDays) : c.dueDay != null ? String(c.dueDay) : '';
  return raw
    .split(/[,\s]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => n >= 1 && n <= 31);
}

// Bill outflows: bill-kind envelopes that have a due day, one per month in range.
export function billEvents(categories, effectiveBudgets, fromStr, toStr) {
  const from = parse(fromStr);
  const to = parse(toStr);
  const events = [];
  for (const c of categories || []) {
    if (c.kind !== 'bill') continue;
    const monthly = Number(effectiveBudgets[c.id] || 0);
    const days = billDueDays(c);
    if (!monthly || days.length === 0) continue;
    // A bill that hits on several days splits its monthly budget evenly.
    const perHit = monthly / days.length;
    // Walk month by month from the start month through the end month.
    let y = from.getFullYear();
    let m = from.getMonth();
    let guard = 0;
    while (guard < 60) {
      for (const day of days) {
        const dd = Math.min(day, daysInMonth(y, m));
        const d = new Date(y, m, dd);
        if (d >= from && d <= to) events.push({ date: iso(d), name: c.name, amount: -perHit, kind: 'bill' });
      }
      const monthStart = new Date(y, m, 1);
      if (monthStart > to) break;
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
