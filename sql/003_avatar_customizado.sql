-- ------------------------------------------------------------------
-- Foto de perfil enviada pela pessoa, separada do avatar do OAuth.
--
-- avatar_url é espelhado do provedor (Google etc.) a cada login — se a
-- foto customizada fosse guardada na MESMA coluna, o próximo login
-- sobrescreveria ela. Fica numa coluna própria, que upsertUser() nunca
-- toca, e que tem prioridade sobre avatar_url onde os dois aparecem.
--
-- O limite de tamanho aqui é o cinto de segurança do banco: o tamanho
-- de verdade é decidido no cliente (a foto é redimensionada antes de
-- sair do navegador) e checado de novo na rota da API.
-- ------------------------------------------------------------------

alter table public.users add column if not exists custom_avatar text;
alter table public.users drop constraint if exists users_custom_avatar_tamanho;
alter table public.users add constraint users_custom_avatar_tamanho
  check (custom_avatar is null or length(custom_avatar) <= 200000);
