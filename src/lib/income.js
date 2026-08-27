// Mirrors isPayrollDeposit in supabase/functions/_shared/syncTransactions.ts —
// real paycheck deposits, as opposed to Zelle/Venmo/wire transfers moved
// around for investing.
export function isPayrollDeposit(description) {
  return /payroll/i.test(description || '');
}
