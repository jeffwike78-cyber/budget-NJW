-- SECURITY HARDENING — run once in Supabase: Project → SQL Editor → New query →
-- paste → Run. Safe to re-run (drops-if-exists first).
--
-- Before: the budget tables allowed the PUBLIC (anonymous) role, so the anon key
-- that ships in the frontend could read/write your data directly — the login
-- only gated the UI. After: only SIGNED-IN (authenticated) users can reach the
-- data. The server-side service_role key still bypasses RLS, so the Plaid sync
-- keeps working.
--
-- IMPORTANT companion step (do this too, in the dashboard):
--   Authentication → Sign In / Providers (or Settings) → turn OFF
--   "Allow new users to sign up". Because there is one shared budget row that any
--   authenticated user can read, open sign-ups would let a stranger register and
--   see everything. With sign-ups off, only your already-invited accounts exist.
--   (Add family members via Authentication → Users → Add user.)

-- app_state -----------------------------------------------------------------
drop policy if exists "anyone with the anon key can read" on app_state;
drop policy if exists "anyone with the anon key can insert" on app_state;
drop policy if exists "anyone with the anon key can update" on app_state;
drop policy if exists "signed-in read" on app_state;
drop policy if exists "signed-in insert" on app_state;
drop policy if exists "signed-in update" on app_state;
create policy "signed-in read" on app_state for select to authenticated using (true);
create policy "signed-in insert" on app_state for insert to authenticated with check (true);
create policy "signed-in update" on app_state for update to authenticated using (true);

-- budget_transactions -------------------------------------------------------
drop policy if exists "anyone with the anon key can read transactions" on budget_transactions;
drop policy if exists "anyone with the anon key can insert transactions" on budget_transactions;
drop policy if exists "anyone with the anon key can update transactions" on budget_transactions;
drop policy if exists "anyone with the anon key can delete transactions" on budget_transactions;
drop policy if exists "signed-in read tx" on budget_transactions;
drop policy if exists "signed-in insert tx" on budget_transactions;
drop policy if exists "signed-in update tx" on budget_transactions;
drop policy if exists "signed-in delete tx" on budget_transactions;
create policy "signed-in read tx" on budget_transactions for select to authenticated using (true);
create policy "signed-in insert tx" on budget_transactions for insert to authenticated with check (true);
create policy "signed-in update tx" on budget_transactions for update to authenticated using (true);
create policy "signed-in delete tx" on budget_transactions for delete to authenticated using (true);

-- investment_holdings -------------------------------------------------------
drop policy if exists "anyone with the anon key can read holdings" on investment_holdings;
drop policy if exists "signed-in read holdings" on investment_holdings;
create policy "signed-in read holdings" on investment_holdings for select to authenticated using (true);
