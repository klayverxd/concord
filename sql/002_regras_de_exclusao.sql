-- ------------------------------------------------------------------
-- O que acontece quando alguém apaga a conta.
--
-- Na migração 001 quatro chaves estrangeiras ficaram em NO ACTION por
-- omissão, não por decisão — e o sintoma foi bom: tentar apagar uma pessoa
-- deu erro de violação de chave em `guilds`, com mensagem que não explica
-- nada. Aqui cada caso ganha uma resposta deliberada.
-- ------------------------------------------------------------------

-- guilds.owner_id → RESTRICT explícito.
-- Apagar a conta de quem é dono NÃO pode levar o servidor junto: outras
-- pessoas usam ele. Como no Discord, a pessoa precisa passar a posse ou
-- apagar o servidor antes. O código traduz esse erro numa frase legível.
alter table public.guilds drop constraint if exists guilds_owner_id_fkey;
alter table public.guilds
  add constraint guilds_owner_id_fkey
  foreign key (owner_id) references public.users(id) on delete restrict;

-- messages.author_id → CASCADE.
-- "Apague meus dados" tem que levar o que a pessoa escreveu.
alter table public.messages drop constraint if exists messages_author_id_fkey;
alter table public.messages
  add constraint messages_author_id_fkey
  foreign key (author_id) references public.users(id) on delete cascade;

-- invites.inviter_id → CASCADE. Convite de quem não existe mais não serve.
alter table public.invites drop constraint if exists invites_inviter_id_fkey;
alter table public.invites
  add constraint invites_inviter_id_fkey
  foreign key (inviter_id) references public.users(id) on delete cascade;

-- bans.banned_by → SET NULL.
-- O banimento precisa SOBREVIVER: se ele fosse embora com a conta de quem
-- baniu, apagar a própria conta viraria caminho para desbanir gente. Só se
-- perde o registro de quem aplicou, e para isso a coluna aceita nulo.
alter table public.bans alter column banned_by drop not null;
alter table public.bans drop constraint if exists bans_banned_by_fkey;
alter table public.bans
  add constraint bans_banned_by_fkey
  foreign key (banned_by) references public.users(id) on delete set null;
