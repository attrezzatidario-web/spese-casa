-- =========================================================
-- Spese Casa — Supabase, passo 10: sezione Marketing del pannello
-- Campagne, calendario dei contenuti, link tracciati e file allegati.
-- Tutto è visibile e modificabile SOLO dagli amministratori (tabella app_admins).
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) CAMPAGNE
create table if not exists public.mk_campagne (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  obiettivo   text not null default 'iscrizioni',
  canali      text[] not null default '{}',
  inizio      date not null default current_date,
  fine        date,
  budget      numeric(12,2) not null default 0,
  spesa       numeric(12,2) not null default 0,
  impression  bigint not null default 0,
  click       bigint not null default 0,
  installazioni bigint not null default 0,
  codice      text unique,
  colore      text not null default '#17795a',
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2) CONTENUTI (calendario editoriale e bacheca)
create table if not exists public.mk_contenuti (
  id          uuid primary key default gen_random_uuid(),
  titolo      text not null,
  tipo        text not null default 'post',
  canale      text not null default 'instagram',
  stato       text not null default 'idea',
  data        date,
  ora         text not null default '',
  campagna_id uuid references public.mk_campagne(id) on delete set null,
  link        text not null default '',
  file_path   text not null default '',
  file_nome   text not null default '',
  file_tipo   text not null default '',
  file_size   bigint not null default 0,
  note        text not null default '',
  ordine      double precision not null default 0,
  avvisato    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mk_contenuti_data on public.mk_contenuti (data);

-- solo gli amministratori leggono e scrivono
alter table public.mk_campagne enable row level security;
alter table public.mk_contenuti enable row level security;
drop policy if exists mk_campagne_admin on public.mk_campagne;
create policy mk_campagne_admin on public.mk_campagne for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists mk_contenuti_admin on public.mk_contenuti;
create policy mk_contenuti_admin on public.mk_contenuti for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
grant select, insert, update, delete on public.mk_campagne, public.mk_contenuti to authenticated;

-- 3) DA DOVE ARRIVANO I NUOVI ISCRITTI (link tracciati ?ref=CODICE)
create table if not exists public.signup_sources (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  codice     text not null,
  created_at timestamptz not null default now()
);
alter table public.signup_sources enable row level security;   -- nessuna regola: si scrive solo con la funzione qui sotto

-- l'app la chiama una volta dopo l'accesso, se l'utente è arrivato da un link di campagna
-- (vale solo per account creati da meno di 2 giorni, e una volta sola)
create or replace function public.record_signup_source(codice text) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare c text := lower(left(regexp_replace(coalesce(codice, ''), '[^a-zA-Z0-9_-]', '', 'g'), 40));
begin
  if auth.uid() is null or c = '' then return false; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and created_at > now() - interval '2 days') then return false; end if;
  insert into public.signup_sources (user_id, codice) values (auth.uid(), c) on conflict do nothing;
  return found;
end $$;
revoke all on function public.record_signup_source(text) from public, anon;
grant execute on function public.record_signup_source(text) to authenticated;

-- 4) NUMERI PER IL PANNELLO: iscritti al giorno in un periodo e iscritti per codice
create or replace function public.admin_marketing(da date, a date) returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare r json;
begin
  perform public.admin_check();
  select json_build_object(
    'giorni', (select coalesce(json_agg(json_build_object('d', g.d, 'n',
                 (select count(*) from auth.users u where (u.created_at at time zone 'Europe/Rome')::date = g.d)) order by g.d), '[]'::json)
               from (select generate_series(da, a, interval '1 day')::date d) g),
    'codici', (select coalesce(json_object_agg(codice, n), '{}'::json)
               from (select codice, count(*) n from public.signup_sources group by codice) x),
    'tracciati', (select count(*) from public.signup_sources),
    'utenti', (select count(*) from auth.users)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_marketing(date, date) from public, anon;
grant execute on function public.admin_marketing(date, date) to authenticated;

-- 5) FILE ALLEGATI: cartella privata "marketing" (immagini e PDF fino a 10 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing', 'marketing', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists mk_files_admin_sel on storage.objects;
create policy mk_files_admin_sel on storage.objects for select to authenticated using (bucket_id = 'marketing' and public.is_app_admin());
drop policy if exists mk_files_admin_ins on storage.objects;
create policy mk_files_admin_ins on storage.objects for insert to authenticated with check (bucket_id = 'marketing' and public.is_app_admin());
drop policy if exists mk_files_admin_del on storage.objects;
create policy mk_files_admin_del on storage.objects for delete to authenticated using (bucket_id = 'marketing' and public.is_app_admin());

-- 6) PROMEMORIA: il database chiama la funzione ogni ora; alle 18 (ora italiana) avvisa delle pubblicazioni di domani
select cron.unschedule(jobid) from cron.job where jobname = 'spese-casa-marketing';
select cron.schedule(
  'spese-casa-marketing',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://yxfrevixckortffogmbb.supabase.co/functions/v1/admin',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"azione": "marketing_domani"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
