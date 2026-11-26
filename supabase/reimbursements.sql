-- Family reimbursements — run once in Supabase: SQL Editor → New query → Run.
--
-- Adds two columns used by the Family Reimbursement page:
--   reimburse_from  — the family member who owes a purchase back (or who a
--                     payback deposit came from). Any transaction with this set
--                     is treated as a short-term IOU: it's kept out of household
--                     envelope spending and out of income, and tracked per
--                     person on the Family Reimbursement page instead.
--   reimbursed_at   — timestamp a reimbursable purchase was marked reimbursed
--                     (null = still outstanding).
--
-- Safe and additive: both columns are nullable, existing rows get NULL, and no
-- existing data, budget amounts, or envelope schedules change. The app also
-- tolerates these columns being absent until this is run.

alter table budget_transactions
  add column if not exists reimburse_from text,
  add column if not exists reimbursed_at timestamptz;
