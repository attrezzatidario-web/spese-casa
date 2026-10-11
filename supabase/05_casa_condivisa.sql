-- =========================================================
-- Spese Casa — Supabase, passo 5: casa condivisa
-- Inviti con codice, elenco membri, uscita e rimozione.
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) INVITI (codice di 6 cifre, valido 24 ore, usabile una volta)
create table if not exists public.household_invites (
  code         text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null,
  used_by      uuid references auth.users(id) on delete set null,
  used_at      timestamptz
);
alter table public.household_invites enable row level security;   -- solo tramite le funzioni qui sotto

-- casa dell'utente collegato
create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid() order by created_at limit 1;
$$;

-- crea una casa nuova e vuota per un utente (quando esce o viene tolto)
create or replace function public.new_home_for(u uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  insert into public.households (name, created_by) values ('Casa', u) returning id into hh;
  insert into public.household_members (household_id, user_id, role) values (hh, u, 'owner');
  return hh;
end $$;

-- 2) CREA UN INVITO
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public as $$
declare hh uuid := public.my_household(); c text; i int := 0;
begin
  if hh is null then raise exception 'Casa non trovata'; end if;
  delete from public.household_invites where expires_at < now() or used_at is not null;
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.household_invites where code = c);
    i := i + 1; if i > 20 then raise exception 'Riprova'; end if;
  end loop;
  insert into public.household_invites (code, household_id, created_by, expires_at)
  values (c, hh, auth.uid(), now() + interval '24 hours');
  return c;
end $$;

-- 3) ENTRA IN UNA CASA CON IL CODICE
-- L'utente lascia la casa in cui era: se ne era l'unico membro, quella casa e i suoi dati vengono eliminati.
create or replace function public.join_household(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.household_invites; old uuid;
begin
  select * into inv from public.household_invites where code = trim(c) for update;
  if inv.code is null or inv.used_at is not null or inv.expires_at < now() then raise exception 'Codice non valido o scaduto'; end if;
  if exists (select 1 from public.household_members where household_id = inv.household_id and user_id = auth.uid()) then
    raise exception 'Fai già parte di questa casa';
  end if;
  for old in select household_id from public.household_members where user_id = auth.uid() loop
    delete from public.household_members where household_id = old and user_id = auth.uid();
    delete from public.push_subscriptions where household_id = old and user_id = auth.uid();
    if not exists (select 1 from public.household_members where household_id = old) then
      delete from public.households where id = old;
    end if;
  end loop;
  insert into public.household_members (household_id, user_id, role) values (inv.household_id, auth.uid(), 'member');
  update public.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  update public.ai_keys set household_id = inv.household_id where user_id = auth.uid();
  return inv.household_id;
end $$;

-- 4) MEMBRI DELLA CASA
create or replace function public.list_members()
returns table (user_id uuid, email text, role text, is_me boolean, joined timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.user_id = auth.uid(), m.created_at
  from public.household_members m join auth.users u on u.id = m.user_id
  where m.household_id = public.my_household()
  order by m.created_at;
$$;

-- 5) TOGLIE UN MEMBRO (solo chi ha creato la casa). Chi viene tolto riparte da una casa vuota.
create or replace function public.remove_member(u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare hh uuid := public.my_household();
begin
  if not exists (select 1 from public.household_members where household_id = hh and user_id = auth.uid() and role = 'owner') then
    raise exception 'Solo chi ha creato la casa può togliere un membro';
  end if;
  if u = auth.uid() then raise exception 'Per uscire usa "Esci dalla casa"'; end if;
  delete from public.household_members where household_id = hh and user_id = u;
  delete from public.push_subscriptions where household_id = hh and user_id = u;
  delete from public.ai_keys where user_id = u and household_id = hh;
  perform public.new_home_for(u);
end $$;

-- 6) ESCI DALLA CASA (riparti da una casa vuota)
create or replace function public.leave_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare hh uuid := public.my_household(); nuovo uuid;
begin
  if (select count(*) from public.household_members where household_id = hh) < 2 then raise exception 'Sei l''unico membro di questa casa'; end if;
  delete from public.household_members where household_id = hh and user_id = auth.uid();
  delete from public.push_subscriptions where household_id = hh and user_id = auth.uid();
  delete from public.ai_keys where user_id = auth.uid();
  -- se in casa non resta un proprietario, lo diventa il membro più vecchio
  if not exists (select 1 from public.household_members where household_id = hh and role = 'owner') then
    update public.household_members set role = 'owner'
    where household_id = hh and user_id = (select user_id from public.household_members where household_id = hh order by created_at limit 1);
  end if;
  nuovo := public.new_home_for(auth.uid());
  return nuovo;
end $$;

revoke all on function public.my_household() from public, anon;
revoke all on function public.new_home_for(uuid) from public, anon, authenticated;
revoke all on function public.create_invite() from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.list_members() from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.leave_household() from public, anon;
grant execute on function public.my_household() to authenticated;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.list_members() to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.leave_household() to authenticated;
