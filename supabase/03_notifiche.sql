-- =========================================================
-- Spese Casa — Supabase, passo 3: notifiche sul telefono
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- (prima va pubblicata la funzione "notifiche")
-- =========================================================

-- 1) I DISPOSITIVI ISCRITTI ALLE NOTIFICHE
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device       text,
  created_at   timestamptz not null default now(),
  last_ok      timestamptz
);
create index if not exists push_subs_hh on public.push_subscriptions (household_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists ps_select on public.push_subscriptions;
create policy ps_select on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists ps_insert on public.push_subscriptions;
create policy ps_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid() and public.is_member(household_id));

drop policy if exists ps_update on public.push_subscriptions;
create policy ps_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(household_id));

drop policy if exists ps_delete on public.push_subscriptions;
create policy ps_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- 2) REGISTRO DEGLI INVII (evita doppioni). Lo usa solo il server.
create table if not exists public.notif_log (
  sub_id     uuid not null references public.push_subscriptions(id) on delete cascade,
  key        text not null,
  created_at timestamptz not null default now(),
  primary key (sub_id, key)
);
alter table public.notif_log enable row level security;

-- 3) CONTROLLO AUTOMATICO OGNI ORA (alle :05)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'spese-casa-notifiche';

select cron.schedule(
  'spese-casa-notifiche',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://yxfrevixckortffogmbb.supabase.co/functions/v1/notifiche',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
