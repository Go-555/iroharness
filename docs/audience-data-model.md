# Audience Data Model

IroHarness treats audience identity as a macro-harness concern. Platform IDs are
not the person. They are identities linked to one durable user record.

```text
users
  id
  displayName
  role
  relationship
  permissions
  metadata

userIdentities
  userId
  platform          youtube | discord | slack | vscode | browser | m5stack | even-g2
  platformUserId
  displayName
  metadata

permissionOverrides
  userId
  permission        delegate_work | deep_discussion | manage_stream | manage_users
  effect            allow | deny
  scope             global | stream:youtube | platform:discord | streamSession:id
  expiresAt

streamSessions
  platform
  platformChannelId
  title
  hostUserId
  status            live | ended | paused
  metadata
```

## Why This Shape

The character should not become a different personality because the user speaks
from YouTube instead of Discord. The registry resolves each incoming platform
identity into the same user before routing, permissions, PJOS, or model
selection happen.

```text
youtube:UCxxx  ----+
discord:12345  ----+--> user_keita --> role/overrides --> Iroha response
slack:U123     ----+
```

Roles describe the stable relationship. Permission overrides describe temporary
or narrow operational powers, such as a fan helping moderate a stream without
becoming a developer.

Scopes are evaluated against the current input context. `global` always applies.
`stream:youtube` applies only to YouTube-sourced stream turns, while
`platform:discord` applies only to Discord identities. This keeps a stream rule
from accidentally changing private developer workflows.

## Example

```js
const registry = createFileUserRegistry({ path: ".iroharness/audience.json" });

registry.registerUser({
  id: "user_keita",
  displayName: "Keita",
  role: "developer",
  identities: {
    discord: "123456"
  }
});

registry.linkIdentity({
  userId: "user_keita",
  platform: "youtube",
  platformUserId: "UCxxx",
  displayName: "Keita Channel"
});

registry.createStreamSession({
  id: "youtube_stream_1",
  platform: "youtube",
  platformChannelId: "live-chat-id",
  title: "IroHarness Dev Stream",
  hostUserId: "user_keita"
});
```

The same user can now talk from Discord or YouTube while the same character
identity, memory, and permission policy remain in charge.

## PostgreSQL / Supabase

For production use, start from the canonical schema:

```text
protocols/sql/postgres-audience.sql
```

It creates:

- `iroharness_users`
- `iroharness_user_identities`
- `iroharness_permission_overrides`
- `iroharness_stream_sessions`
- `iroharness_resolved_users`

The key invariant is `unique (platform, platform_user_id)` on identities. A
YouTube channel ID, Discord user ID, Slack user ID, browser identity, M5Stack
device ID, or Even G2 pairing ID can map to exactly one user record. That keeps
the person stable before permissions, routing, PJOS, or model selection run.

Use `permissionOverrides` for temporary or scoped powers such as:

- allowing a trusted fan to manage a YouTube stream
- denying `delegate_work` during a public stream
- allowing a developer-only Discord identity to call Codex or Claude Code

The file registry remains useful for local demos. The SQL schema is the intended
shape for long-running OBS, YouTube, Discord, and multi-device deployments.

Use `createPostgresUserRegistry` with any `pg`-style query function:

```js
import { createPostgresUserRegistry } from "iroharness";

const userRegistry = createPostgresUserRegistry({
  query: (sql, params) => pool.query(sql, params)
});
```

The adapter has the same methods as the file and in-memory registries, but its
methods are async. `createIroHarness().receive(...)` awaits actor resolution, so
the same macro harness can run against a local JSON file during development and
PostgreSQL/Supabase in production.
