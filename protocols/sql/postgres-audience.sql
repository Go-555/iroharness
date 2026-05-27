-- IroHarness audience registry schema for PostgreSQL / Supabase.
-- The macro harness owns user identity, permissions, and stream session state.

create table if not exists iroharness_users (
  id text primary key,
  display_name text not null,
  role text not null check (
    role in ('owner', 'developer', 'moderator', 'member', 'fan', 'anonymous')
  ),
  relationship text not null default 'public' check (
    relationship in ('owner', 'developer', 'trusted', 'member', 'public')
  ),
  permissions text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists iroharness_user_identities (
  id text primary key,
  user_id text not null references iroharness_users(id) on delete cascade,
  platform text not null,
  platform_user_id text not null,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, platform_user_id),
  unique (user_id, platform, platform_user_id)
);

create index if not exists iroharness_user_identities_user_id_idx
  on iroharness_user_identities(user_id);

create index if not exists iroharness_user_identities_platform_idx
  on iroharness_user_identities(platform, platform_user_id);

create table if not exists iroharness_permission_overrides (
  id text primary key,
  user_id text not null references iroharness_users(id) on delete cascade,
  permission text not null check (
    permission in ('chat_public', 'deep_discussion', 'delegate_work', 'manage_stream', 'manage_users')
  ),
  effect text not null check (effect in ('allow', 'deny')),
  scope text not null default 'global',
  reason text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, permission, scope)
);

create index if not exists iroharness_permission_overrides_user_id_idx
  on iroharness_permission_overrides(user_id);

create index if not exists iroharness_permission_overrides_scope_idx
  on iroharness_permission_overrides(scope);

create table if not exists iroharness_stream_sessions (
  id text primary key,
  platform text not null,
  platform_channel_id text not null,
  title text,
  host_user_id text references iroharness_users(id) on delete set null,
  status text not null default 'live' check (status in ('live', 'paused', 'ended')),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, platform_channel_id, started_at)
);

create index if not exists iroharness_stream_sessions_platform_idx
  on iroharness_stream_sessions(platform, platform_channel_id);

create index if not exists iroharness_stream_sessions_status_idx
  on iroharness_stream_sessions(status);

create table if not exists iroharness_audit_log (
  id text primary key,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists iroharness_audit_log_user_id_idx
  on iroharness_audit_log(user_id);

create index if not exists iroharness_audit_log_action_idx
  on iroharness_audit_log(action);

create index if not exists iroharness_audit_log_resource_idx
  on iroharness_audit_log(resource_type, resource_id);

create or replace function iroharness_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists iroharness_users_touch_updated_at on iroharness_users;
create trigger iroharness_users_touch_updated_at
  before update on iroharness_users
  for each row execute function iroharness_touch_updated_at();

drop trigger if exists iroharness_user_identities_touch_updated_at on iroharness_user_identities;
create trigger iroharness_user_identities_touch_updated_at
  before update on iroharness_user_identities
  for each row execute function iroharness_touch_updated_at();

drop trigger if exists iroharness_permission_overrides_touch_updated_at on iroharness_permission_overrides;
create trigger iroharness_permission_overrides_touch_updated_at
  before update on iroharness_permission_overrides
  for each row execute function iroharness_touch_updated_at();

drop trigger if exists iroharness_stream_sessions_touch_updated_at on iroharness_stream_sessions;
create trigger iroharness_stream_sessions_touch_updated_at
  before update on iroharness_stream_sessions
  for each row execute function iroharness_touch_updated_at();

create or replace view iroharness_resolved_users as
select
  u.id,
  u.display_name,
  u.role,
  u.relationship,
  u.permissions,
  u.metadata,
  coalesce(
    jsonb_object_agg(i.platform, i.platform_user_id)
      filter (where i.platform is not null),
    '{}'::jsonb
  ) as identities
from iroharness_users u
left join iroharness_user_identities i on i.user_id = u.id
group by u.id;
