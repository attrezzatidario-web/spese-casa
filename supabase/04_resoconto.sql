-- =========================================================
-- Spese Casa — Supabase, passo 4: resoconto IA
-- La chiave Gemini dell'utente, salvata solo se attiva il resoconto.
-- Nessuno la può rileggere dall'app: la usa solo la funzione "notifiche".
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

create table if not exists public.ai_keys (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  key          text not null,
  updated_at   timestamptz not null default now()
);
alter table public.ai_keys enable row level security;   -- nessuna regola: dall'app non si legge

-- salva o aggiorna la chiave dell'utente collegato
create or replace function public.set_ai_key(k text) returns void
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  if coalesce(length(trim(k)), 0) < 20 then raise exception 'Chiave non valida'; end if;
  select household_id into hh from public.household_members where user_id = auth.uid() order by created_at limit 1;
  if hh is null then raise exception 'Casa non trovata'; end if;
  insert into public.ai_keys (user_id, household_id, key, updated_at)
  values (auth.uid(), hh, trim(k), now())
  on conflict (user_id) do update set key = excluded.key, household_id = excluded.household_id, updated_at = now();
end $$;

-- toglie la chiave
create or replace function public.delete_ai_key() returns void
language sql security definer set search_path = public as $$
  delete from public.ai_keys where user_id = auth.uid();
$$;

revoke all on function public.set_ai_key(text) from public, anon;
revoke all on function public.delete_ai_key() from public, anon;
grant execute on function public.set_ai_key(text) to authenticated;
grant execute on function public.delete_ai_key() to authenticated;
