-- BUDGET VERSION HISTORY — run once in Supabase: SQL Editor → New query → Run.
--
-- Your budget lives in one row (app_state, id='main') that is overwritten on
-- every save, with no history — so a stale device/tab saving an old copy can
-- silently revert everyone. This adds an automatic, server-side history: every
-- time the budget changes, the PREVIOUS version is snapshotted into
-- app_state_history first. Nothing in the app has to remember to do it, and it
-- can't be defeated by a client bug. Keeps the last 100 versions per row.
--
-- NOTE: this can only recover versions saved AFTER you install it. It cannot
-- retrieve a version that was overwritten before this trigger existed.

create table if not exists app_state_history (
  id bigint generated always as identity primary key,
  row_id text not null,
  budget jsonb not null,
  saved_at timestamptz not null default now()
);

alter table app_state_history enable row level security;
drop policy if exists "signed-in read history" on app_state_history;
create policy "signed-in read history" on app_state_history
  for select to authenticated using (true);

-- SECURITY DEFINER so the snapshot insert runs regardless of who triggered the
-- update (the authenticated client, or the server-side service role).
create or replace function snapshot_app_state_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.budget is distinct from old.budget
     and old.budget is not null
     and old.budget <> '{}'::jsonb then
    insert into app_state_history (row_id, budget, saved_at)
    values (old.id, old.budget, now());
    -- keep only the 100 most recent versions per row
    delete from app_state_history a
    where a.row_id = old.id
      and a.id not in (
        select id from app_state_history
        where row_id = old.id
        order by saved_at desc
        limit 100
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_app_state_budget on app_state;
create trigger trg_snapshot_app_state_budget
  before update on app_state
  for each row execute function snapshot_app_state_budget();

-- ── How to recover later ──────────────────────────────────────────────────
-- List recent versions (newest first), with a quick sanity column:
--   select id, saved_at,
--          jsonb_array_length(budget->'categories') as categories
--   from app_state_history where row_id = 'main'
--   order by saved_at desc limit 30;
--
-- Restore a chosen version (this first snapshots the current one, so it's safe):
--   update app_state set budget = (
--     select budget from app_state_history where id = <PASTE_ID_HERE>
--   ) where id = 'main';
-- Then reload the app.
