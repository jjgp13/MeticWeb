-- =============================================================================
-- MeticWeb leaderboard: server-gated score submission ("Level 2" security)
-- =============================================================================
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
--
-- Goal: a score can ONLY be written by going through a real, single-use match.
-- We do this WITHOUT Edge Functions, using two SECURITY DEFINER functions that
-- anon may call via RPC:
--   * start_match()  -> issues a server-timestamped, single-use match id.
--   * submit_run(...) -> atomically consumes the match, checks the score is
--                        plausible for the elapsed time, and inserts the score.
-- Direct anon INSERT into `scores` is revoked, so forging a row by hitting the
-- REST endpoint with the public anon key no longer works.
--
-- NOTE: this raises the bar a lot (blocks devtools/REST forgery and bots that
-- skip the match flow) but, like any client-scored game, cannot fully stop a
-- determined attacker who scripts "start -> wait -> submit a plausible score".
-- =============================================================================

-- 1) Widen initials to 3-6 chars (matches the in-game length selector). --------
--    `name` is referenced by the anon-insert policy, so drop that policy first.
drop policy if exists "anon insert" on public.scores;

alter table public.scores alter column name type varchar(6);

alter table public.scores drop constraint if exists scores_name_chk;
alter table public.scores
  add constraint scores_name_chk check (name ~ '^[A-Z0-9]{3,6}$');

-- 2) Revoke direct anon writes. Anon keeps SELECT (public read) only. ----------
--    We do NOT recreate an anon insert policy: the only write path is the
--    SECURITY DEFINER submit_run() function below.
revoke insert on public.scores from anon;

-- 3) Match tickets: one row per started game, single-use, server-timestamped. --
create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  issued_at  timestamptz not null default now(),
  used       boolean not null default false
);
create index if not exists matches_issued_at_idx on public.matches (issued_at);

-- RLS on, with NO policies: anon can't read/write matches directly. Only the
-- SECURITY DEFINER functions (run as owner) touch this table.
alter table public.matches enable row level security;

-- 4) start_match(): issue a fresh single-use match id (server clock only). -----
create or replace function public.start_match()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Opportunistic cleanup so the table never grows unbounded.
  delete from public.matches where issued_at < now() - interval '1 day';

  insert into public.matches default values returning id into v_id;
  return v_id;
end;
$$;

-- 5) submit_run(): atomically consume a match + plausibility-check + insert. ---
--    Everything runs in one transaction: if any check fails we RAISE, which
--    rolls back the match consumption too, so a rejected attempt never burns a
--    legitimate ticket. Returns the new row id and the competition rank.
create or replace function public.submit_run(
  p_match uuid,
  p_name  text,
  p_score int
)
returns table (row_id bigint, rank int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issued  timestamptz;
  v_elapsed numeric;
  v_cap     int;
  v_id      bigint;
begin
  if p_name !~ '^[A-Z0-9]{3,6}$' then
    raise exception 'invalid name';
  end if;
  if p_score is null or p_score < 0 or p_score > 1000000 then
    raise exception 'invalid score';
  end if;

  -- Atomically consume the match only if it is unused and within the valid age
  -- window (>= 2s old to reject instant forgeries, <= 4h to reject stale ids).
  update public.matches
     set used = true
   where id = p_match
     and used = false
     and issued_at <= now() - interval '2 seconds'
     and issued_at >= now() - interval '4 hours'
   returning issued_at into v_issued;

  if v_issued is null then
    raise exception 'invalid or expired match';
  end if;

  -- Plausibility: a generous cap on points-per-second. Real play tops out far
  -- below this (max single kill ~1920 pts and kills are rate-gated), so legit
  -- runs are never rejected while absurd forgeries (e.g. 1,000,000 in seconds)
  -- are.
  v_elapsed := extract(epoch from (now() - v_issued));
  v_cap := least(1000000, ceil(v_elapsed * 3000) + 5000);
  if p_score > v_cap then
    raise exception 'implausible score for elapsed time';
  end if;

  insert into public.scores (name, score)
  values (p_name, p_score)
  returning id into v_id;

  return query
    select v_id,
           (select count(*)::int + 1 from public.scores s where s.score > p_score);
end;
$$;

-- 6) Let the browser (anon) call only these two functions. --------------------
revoke all on function public.start_match() from public;
revoke all on function public.submit_run(uuid, text, int) from public;
grant execute on function public.start_match() to anon, authenticated;
grant execute on function public.submit_run(uuid, text, int) to anon, authenticated;
