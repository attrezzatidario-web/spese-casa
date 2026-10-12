-- =========================================================
-- Spese Casa — Supabase, passo 9: notifica al proprietario per ogni nuovo iscritto
-- Quando qualcuno crea un account, il server avvisa i dispositivi
-- su cui hai attivato le notifiche dal pannello (Sistema > Avvisi).
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) dispositivi del proprietario che ricevono gli avvisi
create table if not exists public.admin_push (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  sub        jsonb not null,
  created_at timestamptz not null default now(),
  last_ok    timestamptz
);
alter table public.admin_push enable row level security;   -- nessuna regola: si usa solo dalle funzioni qui sotto

-- 2) coda dei nuovi iscritti da avvisare (contiene solo email e data, nessun dato dell'app)
create table if not exists public.admin_nuovi (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  totale     int,
  created_at timestamptz not null default now(),
  avvisato   timestamptz
);
alter table public.admin_nuovi enable row level security;

-- 3) salva / togli il dispositivo dal pannello
create or replace function public.admin_push_save(s jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  if coalesce(s->>'endpoint', '') = '' then raise exception 'Iscrizione non valida'; end if;
  insert into public.admin_push (endpoint, user_id, sub) values (s->>'endpoint', auth.uid(), s)
  on conflict (endpoint) do update set user_id = auth.uid(), sub = excluded.sub;
end $$;

create or replace function public.admin_push_delete(ep text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_check();
  delete from public.admin_push where endpoint = ep;
end $$;

create or replace function public.admin_push_count() returns int
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  perform public.admin_check();
  select count(*) into n from public.admin_push;
  return n;
end $$;

revoke all on function public.admin_push_save(jsonb) from public, anon;
revoke all on function public.admin_push_delete(text) from public, anon;
revoke all on function public.admin_push_count() from public, anon;
grant execute on function public.admin_push_save(jsonb) to authenticated;
grant execute on function public.admin_push_delete(text) to authenticated;
grant execute on function public.admin_push_count() to authenticated;

-- 4) ad ogni nuovo account: mette in coda e chiama la funzione "admin" che manda la notifica
--    (se qualcosa va storto la registrazione dell'utente NON viene mai bloccata)
create or replace function public.avvisa_nuovo_iscritto() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  begin
    insert into public.admin_nuovi (user_id, email, totale)
    values (new.id, new.email, (select count(*) from auth.users))
    on conflict do nothing;
    perform net.http_post(
      url := 'https://yxfrevixckortffogmbb.supabase.co/functions/v1/admin',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"azione": "nuovi_iscritti"}'::jsonb,
      timeout_milliseconds := 15000
    );
  exception when others then null;
  end;
  return new;
end $$;
revoke all on function public.avvisa_nuovo_iscritto() from public, anon, authenticated;

drop trigger if exists spese_casa_nuovo_iscritto on auth.users;
create trigger spese_casa_nuovo_iscritto
  after insert on auth.users
  for each row execute function public.avvisa_nuovo_iscritto();
