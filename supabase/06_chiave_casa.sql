-- =========================================================
-- Spese Casa — Supabase, passo 6: chiave IA condivisa dalla casa
-- Chi fa parte della casa trova la chiave già attiva su ogni dispositivo.
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

-- la chiave della casa (l'ultima salvata da un membro)
create or replace function public.get_ai_key() returns text
language sql stable security definer set search_path = public as $$
  select key from public.ai_keys where household_id = public.my_household() order by updated_at desc limit 1;
$$;

-- toglie la chiave per tutta la casa
create or replace function public.delete_household_ai_key() returns void
language sql security definer set search_path = public as $$
  delete from public.ai_keys where household_id = public.my_household();
$$;

revoke all on function public.get_ai_key() from public, anon;
revoke all on function public.delete_household_ai_key() from public, anon;
grant execute on function public.get_ai_key() to authenticated;
grant execute on function public.delete_household_ai_key() to authenticated;
