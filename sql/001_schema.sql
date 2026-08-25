-- ------------------------------------------------------------------
-- Concord — esquema inicial (Postgres / Supabase)
--
-- Cole isto no SQL Editor do Supabase e execute. Pode rodar de novo sem
-- estragar nada: tudo é IF NOT EXISTS.
--
-- Decisão importante: `users.id` referencia `auth.users`, a tabela que o
-- Supabase Auth mantém. Assim não existe uma segunda fonte de verdade
-- sobre quem é quem — a identidade é a do Supabase, e aqui ficam só os
-- dados do aplicativo.
-- ------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ------------------------------ pessoas ------------------------------

create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  name         text not null,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ------------------------------ servidores ------------------------------

create table if not exists public.guilds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  icon_url   text,
  owner_id   uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_guilds_owner on public.guilds(owner_id);

create table if not exists public.guild_members (
  guild_id  uuid not null references public.guilds(id) on delete cascade,
  user_id   uuid not null references public.users(id) on delete cascade,
  nickname  text check (nickname is null or length(btrim(nickname)) between 1 and 32),
  joined_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
create index if not exists idx_members_user on public.guild_members(user_id);

-- ------------------------------ cargos ------------------------------

-- `permissions` é bitfield guardado como texto: inteiro de 64 bits com
-- sinal não cabe o bit alto sem dor, e BigInt em texto atravessa driver,
-- JSON e log sem perder nada.
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  guild_id     uuid not null references public.guilds(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 40),
  color        text,
  permissions  text not null default '0',
  position     integer not null default 0,
  is_everyone  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_roles_guild on public.roles(guild_id, position desc);

-- Cada servidor tem exatamente um @everyone: é a base de onde todo mundo parte.
create unique index if not exists idx_roles_one_everyone
  on public.roles(guild_id) where is_everyone;

create table if not exists public.member_roles (
  guild_id uuid not null references public.guilds(id) on delete cascade,
  user_id  uuid not null references public.users(id) on delete cascade,
  role_id  uuid not null references public.roles(id) on delete cascade,
  primary key (guild_id, user_id, role_id)
);
create index if not exists idx_member_roles_lookup on public.member_roles(guild_id, user_id);

-- ------------------------------ canais ------------------------------

create table if not exists public.channels (
  id         uuid primary key default gen_random_uuid(),
  guild_id   uuid not null references public.guilds(id) on delete cascade,
  type       text not null check (type in ('text', 'voice')),
  name       text not null check (length(btrim(name)) between 1 and 40),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_channels_guild on public.channels(guild_id, type, position);

-- Sobrescrita por canal: o que o cargo (ou a pessoa) ganha e perde ali.
create table if not exists public.channel_overwrites (
  channel_id  uuid not null references public.channels(id) on delete cascade,
  target_type text not null check (target_type in ('role', 'user')),
  target_id   uuid not null,
  allow       text not null default '0',
  deny        text not null default '0',
  primary key (channel_id, target_type, target_id)
);

-- ------------------------------ mensagens ------------------------------

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id  uuid not null references public.users(id),
  content    text not null check (length(content) between 1 and 2000),
  reply_to   uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
-- Paginação da conversa: mais recentes primeiro dentro do canal.
create index if not exists idx_messages_channel on public.messages(channel_id, created_at desc, id desc);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  emoji      text not null check (length(emoji) between 1 and 16),
  primary key (message_id, user_id, emoji)
);

-- ------------------------------ convites e banimentos ------------------------------

create table if not exists public.invites (
  code       text primary key check (length(code) between 6 and 16),
  guild_id   uuid not null references public.guilds(id) on delete cascade,
  inviter_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses   integer check (max_uses is null or max_uses > 0),
  uses       integer not null default 0
);
create index if not exists idx_invites_guild on public.invites(guild_id);

create table if not exists public.bans (
  guild_id   uuid not null references public.guilds(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  reason     text,
  banned_by  uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- ------------------------------ registro de moderação ------------------------------

create table if not exists public.audit_log (
  id         bigserial primary key,
  guild_id   uuid not null references public.guilds(id) on delete cascade,
  actor_id   uuid references public.users(id) on delete set null,
  action     text not null,
  target_id  uuid,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_guild on public.audit_log(guild_id, id desc);

-- ------------------------------ criar servidor ------------------------------

-- Servidor nasce com dono, membro, cargo @everyone e um canal de cada tipo.
-- Numa função só para não existir servidor pela metade se algo falhar no meio.
create or replace function public.create_guild(p_owner uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guild uuid;
begin
  insert into guilds (name, owner_id) values (btrim(p_name), p_owner) returning id into v_guild;
  insert into guild_members (guild_id, user_id) values (v_guild, p_owner);

  -- @everyone já entra podendo ver, falar e conversar; o resto é privilégio.
  insert into roles (guild_id, name, permissions, position, is_everyone)
  values (v_guild, '@everyone', '59', 0, true);   -- VIEW|SEND|CONNECT|SPEAK|STREAM = 1+2+8+16+32

  insert into channels (guild_id, type, name, position) values
    (v_guild, 'text',  'geral', 0),
    (v_guild, 'voice', 'Geral', 0);

  return v_guild;
end;
$$;

-- ------------------------------ trava de acesso ------------------------------

-- O servidor da aplicação fala com o banco pela service role, que passa por
-- cima de RLS. Ligar RLS sem política nenhuma é de propósito: se algum dia a
-- chave anônima escapar para o navegador, ela não lê nada.
alter table public.users              enable row level security;
alter table public.guilds             enable row level security;
alter table public.guild_members      enable row level security;
alter table public.roles              enable row level security;
alter table public.member_roles       enable row level security;
alter table public.channels           enable row level security;
alter table public.channel_overwrites enable row level security;
alter table public.messages           enable row level security;
alter table public.message_reactions  enable row level security;
alter table public.invites            enable row level security;
alter table public.bans               enable row level security;
alter table public.audit_log          enable row level security;
