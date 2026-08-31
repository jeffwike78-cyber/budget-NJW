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

// Transfer outflows: transfer-kind envelopes leave checking on their scheduled
// day-of-month (transferDay), so the money moving out shows up in the timeline.
export function transferEvents(categories, effectiveBudgets, fromStr, toStr) {
  const from = parse(fromStr);
  const to = parse(toStr);
  const events = [];
  for (const c of categories || []) {
    if (c.kind !== 'transfer') continue;
    const monthly = Number(effectiveBudgets[c.id] || 0);
    const day = Number(c.transferDay || 0);
    if (!monthly || !(day >= 1 && day <= 31)) continue;
    monthlyOnDay(day, from, to, (dateStr) =>
      events.push({ date: dateStr, name: c.name, amount: -monthly, kind: 'transfer' })
    );
  }
  return events;
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 86400000));
}

// Build a running-balance projection. Discrete events (income, bills, transfers,
// sinking payouts) land on their dates; everyday-spending envelopes are modeled
// as a smooth daily drain across the month (since those purchases happen all
// month, not on one day). Reports the lowest point the balance reaches and the
// recommended checking buffer — the standing cash to keep so the balance never
// dips below zero as income catches up.
export function projectCashflow({ startingBalance, sources, categories, effectiveBudgets, sinkingFunds, days = 45, fromStr = todayStr() }) {
  const from = parse(fromStr);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  const toStr = iso(to);

  const events = [
    ...incomeEvents(sources, fromStr, toStr),
    ...billEvents(categories, effectiveBudgets, fromStr, toStr),
    ...transferEvents(categories, effectiveBudgets, fromStr, toStr),
    ...sinkingEvents(sinkingFunds, fromStr, toStr),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Everyday-spending drains steadily; spread each spending envelope's monthly
  // budget over an average month.
  const monthlySpend = (categories || [])
    .filter((c) => c.kind === 'spending' && c.id !== 'needs-review')
    .reduce((s, c) => s + Number(effectiveBudgets[c.id] || 0), 0);
  const dailySpend = monthlySpend / 30.44;

  const start = Number(startingBalance || 0);
  let running = start; // balance including current cash
  let net = 0; // cumulative change since today (for the buffer calc)
  let minNet = 0;
  let minDate = fromStr;
  let cursor = from;
  const timeline = [];

  const drain = (untilDate) => {
    const d = daysBetween(cursor, untilDate);
    if (d > 0) {
      running -= dailySpend * d;
      net -= dailySpend * d;
      // drain only decreases, so the low of a gap is at its end
      if (net < minNet) { minNet = net; minDate = iso(untilDate); }
      cursor = untilDate;
    }
  };

  for (const e of events) {
    drain(parse(e.date));
    running += e.amount;
    net += e.amount;
    if (net < minNet) { minNet = net; minDate = e.date; }
    timeline.push({ ...e, balance: running });
  }
  drain(to);

  return {
    timeline,
    endingBalance: running,
    low: start + minNet,
    lowDate: minDate,
    recommendedBuffer: Math.max(0, -minNet),
    dailySpend,
    toStr,
  };
}
