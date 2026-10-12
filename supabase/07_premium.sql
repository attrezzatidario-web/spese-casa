-- =========================================================
-- Spese Casa — Supabase, passo 7: piani Gratis / Premium
-- Il piano vale per tutta la casa: chi entra in una casa Premium ha tutto.
-- I limiti sono applicati qui sul server, non solo nell'app.
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- 1) PIANO DI OGNI CASA
create table if not exists public.household_plans (
  household_id uuid primary key references public.households(id) on delete cascade,
  plan         text not null default 'free' check (plan in ('free','premium')),
  source       text,                 -- trial | apple | google | manual
  product      text,                 -- es. premium_mensile / premium_annuale
  expires_at   timestamptz,          -- null = senza scadenza
  updated_at   timestamptz not null default now()
);
alter table public.household_plans enable row level security;
drop policy if exists plan_select on public.household_plans;
create policy plan_select on public.household_plans for select using (public.is_member(household_id));
-- nessuna regola di scrittura: il piano cambia solo dalle funzioni qui sotto o dal server

-- chi ha già usato la prova gratuita (una volta per persona)
create table if not exists public.trial_users (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  used_at  timestamptz not null default now()
);
alter table public.trial_users enable row level security;

-- 2) LA CASA È PREMIUM?
create or replace function public.is_premium(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_plans
    where household_id = hh and plan = 'premium' and (expires_at is null or expires_at > now())
  );
$$;

-- spazio usato dall'archivio della casa (byte)
create or replace function public.storage_used(hh uuid) returns bigint
language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects
  where bucket_id = 'documenti' and (storage.foldername(name))[1] = hh::text and public.is_member(hh);
$$;

-- 3) PIANO DELLA MIA CASA (per l'app)
create or replace function public.my_plan()
returns table (premium boolean, plan text, source text, product text, expires_at timestamptz, trial_available boolean, storage_used bigint, storage_limit bigint, members int)
language sql stable security definer set search_path = public as $$
  select public.is_premium(h.hh),
         coalesce(p.plan, 'free'), p.source, p.product, p.expires_at,
         not exists (select 1 from public.trial_users t where t.user_id = auth.uid())
           and not exists (select 1 from public.household_plans x where x.household_id = h.hh and x.source is not null),
         public.storage_used(h.hh),
         case when public.is_premium(h.hh) then 2147483648::bigint else 104857600::bigint end,
         (select count(*)::int from public.household_members m where m.household_id = h.hh)
  from (select public.my_household() as hh) h
  left join public.household_plans p on p.household_id = h.hh;
$$;

-- 4) PROVA GRATUITA DI 7 GIORNI (una volta per persona e per casa)
create or replace function public.start_trial() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare hh uuid := public.my_household(); fine timestamptz := now() + interval '7 days';
begin
  if hh is null then raise exception 'Casa non trovata'; end if;
  if public.is_premium(hh) then raise exception 'La casa è già Premium'; end if;
  if exists (select 1 from public.trial_users where user_id = auth.uid())
     or exists (select 1 from public.household_plans where household_id = hh and source is not null) then
    raise exception 'Hai già usato la prova gratuita';
  end if;
  insert into public.trial_users (user_id) values (auth.uid());
  insert into public.household_plans (household_id, plan, source, expires_at, updated_at)
  values (hh, 'premium', 'trial', fine, now())
  on conflict (household_id) do update set plan = 'premium', source = 'trial', expires_at = fine, updated_at = now();
  return fine;
end $$;

revoke all on function public.is_premium(uuid) from public, anon;
revoke all on function public.storage_used(uuid) from public, anon;
grant execute on function public.storage_used(uuid) to authenticated;
revoke all on function public.my_plan() from public, anon;
revoke all on function public.start_trial() from public, anon;
grant execute on function public.is_premium(uuid) to authenticated;
grant execute on function public.my_plan() to authenticated;
grant execute on function public.start_trial() to authenticated;

-- 5) LIMITI APPLICATI DAL SERVER
-- a) Auto, Manutenzioni e Progetti si creano e si modificano solo con Premium
--    (con il piano gratis restano visibili ed eliminabili)
drop policy if exists rec_premium_ins on public.records;
create policy rec_premium_ins on public.records as restrictive for insert
  with check (sheet not in ('Veicoli', 'Manutenzioni', 'Progetti') or public.is_premium(household_id));
drop policy if exists rec_premium_upd on public.records;
create policy rec_premium_upd on public.records as restrictive for update
  using (true)
  with check (sheet not in ('Veicoli', 'Manutenzioni', 'Progetti') or public.is_premium(household_id));

-- b) archivio: 100 MB con il piano gratis
drop policy if exists doc_quota on storage.objects;
create policy doc_quota on storage.objects as restrictive for insert
  with check (bucket_id <> 'documenti'
    or public.is_premium(((storage.foldername(name))[1])::uuid)
    or public.storage_used(((storage.foldername(name))[1])::uuid) < 104857600);

-- c) inviti: solo le case Premium, al massimo 5 persone
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public as $$
declare hh uuid := public.my_household(); c text; i int := 0;
begin
  if hh is null then raise exception 'Casa non trovata'; end if;
  if not public.is_premium(hh) then raise exception 'La casa condivisa è una funzione Premium'; end if;
  if (select count(*) from public.household_members where household_id = hh) >= 5 then raise exception 'La casa ha già 5 persone'; end if;
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

create or replace function public.join_household(c text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.household_invites; old uuid;
begin
  select * into inv from public.household_invites where code = trim(c) for update;
  if inv.code is null or inv.used_at is not null or inv.expires_at < now() then raise exception 'Codice non valido o scaduto'; end if;
  if exists (select 1 from public.household_members where household_id = inv.household_id and user_id = auth.uid()) then
    raise exception 'Fai già parte di questa casa';
  end if;
  if not public.is_premium(inv.household_id) then raise exception 'Questa casa non è più Premium: chiedi a chi ti ha invitato'; end if;
  if (select count(*) from public.household_members where household_id = inv.household_id) >= 5 then raise exception 'La casa ha già 5 persone'; end if;
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

-- d) la chiave IA condivisa e il resoconto funzionano solo con Premium
create or replace function public.get_ai_key() returns text
language sql stable security definer set search_path = public as $$
  select key from public.ai_keys
  where household_id = public.my_household() and public.is_premium(household_id)
  order by updated_at desc limit 1;
$$;

-- 6) LA TUA CASA È PREMIUM SENZA SCADENZA (account del proprietario dell'app)
insert into public.household_plans (household_id, plan, source, expires_at)
select m.household_id, 'premium', 'manual', null
from public.household_members m join auth.users u on u.id = m.user_id
where u.email = 'attrezzatidario@gmail.com'
on conflict (household_id) do update set plan = 'premium', source = 'manual', expires_at = null, updated_at = now();
