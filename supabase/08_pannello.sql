-- =========================================================
-- Spese Casa — Supabase, passo 8: pannello di controllo del proprietario
-- Solo gli amministratori (tabella app_admins) possono usare queste funzioni.
-- Mostrano numeri e stato degli account, MAI spese, importi o documenti degli utenti.
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) AMMINISTRATORI
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;   -- nessuna regola: non leggibile dall'app

insert into public.app_admins (user_id)
select id from auth.users where email = 'attrezzatidario@gmail.com'
on conflict do nothing;

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

create or replace function public.admin_check() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Accesso non autorizzato'; end if;
end $$;

-- 2) PANORAMICA
create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare r json; oggi date := (now() at time zone 'Europe/Rome')::date;
begin
  perform public.admin_check();
  with
  piani as (
    select h.id hh,
      case when p.plan = 'premium' and (p.expires_at is null or p.expires_at > now()) then coalesce(p.source, 'manual') else 'free' end as stato,
      p.expires_at, p.source
    from public.households h left join public.household_plans p on p.household_id = h.id
  ),
  giorni as (select generate_series(oggi - 29, oggi, interval '1 day')::date d)
  select json_build_object(
    'users',            (select count(*) from auth.users),
    'new_today',        (select count(*) from auth.users where (created_at at time zone 'Europe/Rome')::date = oggi),
    'new_7',            (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30',           (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7',         (select count(distinct updated_by) from public.records where updated_at > now() - interval '7 days'),
    'active_today',     (select count(distinct updated_by) from public.records where (updated_at at time zone 'Europe/Rome')::date = oggi),
    'households',       (select count(*) from public.households),
    'shared',           (select count(*) from (select household_id from public.household_members group by household_id having count(*) > 1) x),
    'plan_free',        (select count(*) from piani where stato = 'free'),
    'plan_trial',       (select count(*) from piani where stato = 'trial'),
    'plan_paid',        (select count(*) from piani where stato in ('apple', 'google')),
    'plan_manual',      (select count(*) from piani where stato = 'manual'),
    'trials_used',      (select count(*) from public.trial_users),
    'trials_expiring',  (select count(*) from piani where stato = 'trial' and expires_at < now() + interval '3 days'),
    'push_web',         (select count(*) from public.push_subscriptions where endpoint not like 'fcm:%' and endpoint not like 'apns:%'),
    'push_android',     (select count(*) from public.push_subscriptions where endpoint like 'fcm:%'),
    'push_ios',         (select count(*) from public.push_subscriptions where endpoint like 'apns:%'),
    'push_ok_today',    (select count(*) from public.push_subscriptions where (last_ok at time zone 'Europe/Rome')::date = oggi),
    'ai_households',    (select count(distinct household_id) from public.ai_keys),
    'records',          (select count(*) from public.records),
    'storage_bytes',    (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'documenti'),
    'files',            (select count(*) from storage.objects where bucket_id = 'documenti'),
    'db_bytes',         pg_database_size(current_database()),
    'signups_30',       (select json_agg(json_build_object('d', g.d, 'n', (select count(*) from auth.users u where (u.created_at at time zone 'Europe/Rome')::date = g.d)) order by g.d) from giorni g),
    'active_30',        (select json_agg(json_build_object('d', g.d, 'n', (select count(distinct updated_by) from public.records x where (x.updated_at at time zone 'Europe/Rome')::date = g.d)) order by g.d) from giorni g),
    'now',              now()
  ) into r;
  return r;
end $$;

-- 3) UTENTI (ricerca per email)
create or replace function public.admin_users(q text default '', lim int default 100, off int default 0) returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare r json;
begin
  perform public.admin_check();
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) into r from (
    select u.id as user_id, u.email::text as email, u.created_at, u.last_sign_in_at,
      m.household_id, m.role,
      (select count(*) from public.household_members x where x.household_id = m.household_id) as members,
      case when p.plan = 'premium' and (p.expires_at is null or p.expires_at > now()) then 'premium' else 'free' end as plan,
      p.source, p.product, p.expires_at,
      (select max(updated_at) from public.records x where x.updated_by = u.id) as last_activity,
      (select count(*) from public.records x where x.household_id = m.household_id) as records,
      (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o where o.bucket_id = 'documenti' and (storage.foldername(o.name))[1] = m.household_id::text) as storage_bytes,
      (select count(*) from public.push_subscriptions s where s.user_id = u.id) as devices,
      exists (select 1 from public.trial_users t where t.user_id = u.id) as trial_used,
      exists (select 1 from public.ai_keys k where k.household_id = m.household_id) as ai
    from auth.users u
    left join lateral (select household_id, role from public.household_members where user_id = u.id order by created_at limit 1) m on true
    left join public.household_plans p on p.household_id = m.household_id
    where coalesce(q, '') = '' or u.email ilike '%' || q || '%'
    order by u.created_at desc
    limit greatest(1, least(lim, 500)) offset greatest(0, off)
  ) t;
  return r;
end $$;

-- 4) AZIONI SUL PIANO DI UNA CASA
-- p: 'premium' (regalo, fino a 'fino' oppure per sempre se null) o 'free'
create or replace function public.admin_set_plan(hh uuid, p text, fino timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if p not in ('premium', 'free') then raise exception 'Piano non valido'; end if;
  insert into public.household_plans (household_id, plan, source, expires_at, updated_at)
  values (hh, p, 'manual', case when p = 'premium' then fino else null end, now())
  on conflict (household_id) do update set plan = excluded.plan, source = 'manual', expires_at = excluded.expires_at, updated_at = now();
end $$;

create or replace function public.admin_extend_trial(hh uuid, giorni int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare fine timestamptz;
begin
  perform public.admin_check();
  if giorni < 1 or giorni > 365 then raise exception 'Giorni non validi'; end if;
  select greatest(coalesce(expires_at, now()), now()) + make_interval(days => giorni) into fine
  from public.household_plans where household_id = hh;
  fine := coalesce(fine, now() + make_interval(days => giorni));
  insert into public.household_plans (household_id, plan, source, expires_at, updated_at)
  values (hh, 'premium', 'trial', fine, now())
  on conflict (household_id) do update set plan = 'premium', source = 'trial', expires_at = fine, updated_at = now();
  return fine;
end $$;

-- 5) INVITI
create or replace function public.admin_invites() returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare r json;
begin
  perform public.admin_check();
  select coalesce(json_agg(row_to_json(t) order by t.created desc), '[]'::json) into r from (
    select i.code, i.expires_at, i.used_at, i.expires_at - interval '24 hours' as created,
      (select email::text from auth.users where id = i.created_by) as da,
      (select email::text from auth.users where id = i.used_by) as usato_da,
      case when i.used_at is not null then 'usato' when i.expires_at < now() then 'scaduto' else 'attivo' end as stato
    from public.household_invites i
    order by i.expires_at desc limit 100
  ) t;
  return r;
end $$;

-- 6) SALUTE DEL SISTEMA (orologio delle notifiche e ultime risposte del server)
create or replace function public.admin_system() returns json
language plpgsql stable security definer set search_path = public as $$
declare giri json := '[]'; risposte json := '[]';
begin
  perform public.admin_check();
  begin
    select coalesce(json_agg(row_to_json(t)), '[]'::json) into giri from (
      select d.status, d.start_time, d.end_time, left(coalesce(d.return_message, ''), 160) as msg
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname = 'spese-casa-notifiche' order by d.start_time desc limit 24
    ) t;
  exception when others then giri := '[]';
  end;
  begin
    select coalesce(json_agg(row_to_json(t)), '[]'::json) into risposte from (
      select r.status_code, r.created, left(coalesce(r.content::text, r.error_msg, ''), 4000) as body
      from net._http_response r order by r.created desc limit 12
    ) t;
  exception when others then risposte := '[]';
  end;
  return json_build_object('runs', giri, 'responses', risposte, 'db_bytes', pg_database_size(current_database()));
end $$;

-- permessi: solo utenti collegati (e dentro ogni funzione: solo amministratori)
revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.admin_check() from public, anon, authenticated;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_users(text, int, int) from public, anon;
revoke all on function public.admin_set_plan(uuid, text, timestamptz) from public, anon;
revoke all on function public.admin_extend_trial(uuid, int) from public, anon;
revoke all on function public.admin_invites() from public, anon;
revoke all on function public.admin_system() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_users(text, int, int) to authenticated;
grant execute on function public.admin_set_plan(uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_extend_trial(uuid, int) to authenticated;
grant execute on function public.admin_invites() to authenticated;
grant execute on function public.admin_system() to authenticated;
