-- =========================================================
-- Spese Casa — Supabase, passo 1: struttura del database
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) CASE: ogni utente ha almeno una "casa" (in futuro condivisibile)
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Casa',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 2) CHI FA PARTE DI OGNI CASA
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner','member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- 3) DATI DELL'APP
-- Stessa logica del Foglio Google: "sheet" = nome del foglio (Spese, Bollette, Config…),
-- "id" = id della riga, "data" = la riga intera.
create table if not exists public.records (
  household_id uuid not null references public.households(id) on delete cascade,
  sheet        text not null,
  id           text not null,
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null default auth.uid(),
  primary key (household_id, sheet, id)
);
create index if not exists records_hh_sheet on public.records (household_id, sheet);

-- aggiorna in automatico la data di modifica
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records
for each row execute function public.touch_updated_at();

-- 4) CONTROLLO "fai parte di questa casa?" (usato dalle regole di sicurezza)
create or replace function public.is_member(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hh and user_id = auth.uid()
  );
$$;

-- 5) ALLA REGISTRAZIONE: crea in automatico la casa del nuovo utente
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  insert into public.households (name, created_by) values ('Casa', new.id) returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, new.id, 'owner');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- 6) REGOLE DI SICUREZZA: ognuno vede solo le proprie case
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.records           enable row level security;

drop policy if exists hh_select on public.households;
create policy hh_select on public.households
  for select using (public.is_member(id));

drop policy if exists hh_update on public.households;
create policy hh_update on public.households
  for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists hm_select on public.household_members;
create policy hm_select on public.household_members
  for select using (public.is_member(household_id));

drop policy if exists rec_select on public.records;
create policy rec_select on public.records
  for select using (public.is_member(household_id));

drop policy if exists rec_insert on public.records;
create policy rec_insert on public.records
  for insert with check (public.is_member(household_id));

drop policy if exists rec_update on public.records;
create policy rec_update on public.records
  for update using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists rec_delete on public.records;
create policy rec_delete on public.records
  for delete using (public.is_member(household_id));

-- 7) ARCHIVIO FILE (scontrini, bollette, estratti conto): cartella privata per ogni casa
insert into storage.buckets (id, name, public)
values ('documenti', 'documenti', false)
on conflict (id) do nothing;

drop policy if exists doc_rw on storage.objects;
create policy doc_rw on storage.objects for all
  using (bucket_id = 'documenti' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'documenti' and public.is_member(((storage.foldername(name))[1])::uuid));

-- 8) CANCELLAZIONE ACCOUNT (obbligatoria per gli store)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- elimina le case di cui l'utente è l'unico membro
  delete from public.households h
  where exists (select 1 from public.household_members m where m.household_id = h.id and m.user_id = auth.uid())
    and (select count(*) from public.household_members m where m.household_id = h.id) = 1;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
