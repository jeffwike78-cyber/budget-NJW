-- Phase 6. Run once in Supabase: SQL Editor → New query → paste → Run.

-- A private bucket to hold receipt images/PDFs. Only the server (service_role)
-- reads/writes it; the app shows them through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Tax bucket for the CPA report: 'charitable' | 'medical' | 'business-1' | 'business-2'
-- (null = not tax-tracked). Replaces the old single deductible flag.
alter table budget_transactions add column if not exists tax_category text;

-- Storage path of an attached receipt file, if any.
alter table budget_transactions add column if not exists receipt_path text;
