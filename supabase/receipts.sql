-- Phase 4 (email receipts). Run this once in Supabase: SQL Editor → New query
-- → paste → Run. It adds a place to store connected Gmail accounts and a note
-- field on transactions for the extracted receipt detail.

-- Connected Gmail accounts. Holds OAuth refresh tokens, so — exactly like
-- plaid_items — RLS is enabled with NO policies: only the service_role key
-- (used server-side in the Vercel functions) can touch it. The browser's anon
-- key is fully locked out.
create table if not exists gmail_accounts (
  id text primary key,        -- the Gmail address
  email text not null,
  refresh_token text,         -- may be null if Google didn't return one; that account just can't be searched
  created_at timestamptz not null default now()
);

alter table gmail_accounts enable row level security;

-- A short human summary of what a transaction actually was, filled in from an
-- emailed receipt (e.g. "Apple: iCloud 2TB storage — monthly").
alter table budget_transactions add column if not exists note text;
