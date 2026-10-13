-- =========================================================
-- Spese Casa — Supabase, passo 11: lingue
-- Ogni dispositivo ricorda la lingua scelta nell'app, così le notifiche
-- e il resoconto IA arrivano in italiano, inglese, spagnolo, francese o tedesco.
-- Da incollare in: Supabase > SQL Editor > New query > Run
-- =========================================================

alter table public.push_subscriptions add column if not exists lingua text not null default 'it';

alter table public.push_subscriptions drop constraint if exists push_subscriptions_lingua_check;
alter table public.push_subscriptions add constraint push_subscriptions_lingua_check
  check (lingua in ('it', 'en', 'es', 'fr', 'de'));
