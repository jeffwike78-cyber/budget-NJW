-- Phase 5. Run once in Supabase: SQL Editor → New query → paste → Run.
-- Adds two per-transaction flags:
--   business   — a business/rental expense that posted to a linked account but
--                should NOT count in the household budget (tracked elsewhere)
--   deductible — mark for the tax report (charitable giving, deductible medical, etc.)
alter table budget_transactions add column if not exists business boolean not null default false;
alter table budget_transactions add column if not exists deductible boolean not null default false;
