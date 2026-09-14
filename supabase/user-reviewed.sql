-- AI Reviewed vs User Reviewed — run once in Supabase: SQL Editor → New query → Run.
--
-- Adds a flag that records whether a human has confirmed/corrected a
-- transaction's category. Auto-categorized transactions default to false
-- ("AI Reviewed"); correcting one in the app flips it to true ("User
-- Reviewed"). Manually entered and split transactions are treated as
-- user-reviewed by their source, so they don't need this flag set.
--
-- Safe and additive: existing rows default to false; nothing else changes.

alter table budget_transactions
  add column if not exists user_reviewed boolean not null default false;
