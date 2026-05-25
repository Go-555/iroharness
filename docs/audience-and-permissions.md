# Audience And Permissions

IroHarness keeps personality stable while changing access by person.

The character does not become a different person for every platform. Instead,
each incoming message resolves to an actor:

```text
youtube:UCxxx
discord:123456
slack:U123
browser:browser-guest
```

Those identities point to the same user record through the audience registry.

```json
{
  "id": "user_keita",
  "displayName": "Keita",
  "role": "developer",
  "identities": {
    "youtube": "UCxxx",
    "discord": "123456",
    "slack": "U123"
  },
  "relationship": "developer"
}
```

Internally this is normalized as:

```text
users
userIdentities
permissionOverrides
streamSessions
```

See [audience-data-model.md](./audience-data-model.md) for the table shape and
the persisted JSON contract.

For production deployments, apply the PostgreSQL/Supabase schema in
`protocols/sql/postgres-audience.sql`. It keeps YouTube, Discord, Slack,
VS Code, browser, M5Stack, and Even G2 identities as rows linked to one durable
user.

## Default Roles

| Role | Default Permissions |
|---|---|
| owner | chat, deep discussion, delegate work, manage stream, manage users |
| developer | chat, deep discussion, delegate work |
| moderator | chat, deep discussion, manage stream |
| member | chat, deep discussion |
| fan | public chat |
| anonymous | public chat |

## Why This Matters

YouTube and Discord fans can talk with the character. Developers can have deep
architecture discussion and trigger work through Codex, OpenClaw, Hermes, or
other micro harnesses.

The same Iroha appears to everyone. The permissions change, not the personality.

## Audience Context

After user resolution, the macro harness creates an `audience` context for the
turn. Brains, stream controllers, and delegated micro harnesses receive this
context alongside `character`, `actor`, `input`, `route`, and Project OS state.

Example:

```json
{
  "tier": "trusted",
  "relationship": "core-developer",
  "responseDepth": "deep",
  "canDeepDiscuss": true,
  "canDelegateWork": true,
  "canManageStream": false,
  "identityStable": true
}
```

This lets the same character talk casually with fans, hold deeper architecture
discussions with developers, and deny privileged operations when needed without
creating platform-specific personalities.

## OBS / YouTube Streaming

Use the browser avatar as an OBS Browser Source:

```text
http://127.0.0.1:4178/?view=overlay
```

For a named stream identity:

```text
http://127.0.0.1:4178/?view=overlay&platform=youtube&user=UCxxx&name=Keita
```

The overlay hides the control panel and uses a transparent background. OBS can
compose it above gameplay, slides, coding screens, or a Live2D/3D scene.

## Discord Multi-Person Chats

A Discord adapter should pass the platform identity into `/turn`:

```json
{
  "source": "discord",
  "modality": "text",
  "text": "Codexでこのコードをレビューして",
  "actor": {
    "platform": "discord",
    "platformUserId": "123456",
    "displayName": "Fan One"
  }
}
```

The macro harness will resolve the actor, evaluate permissions, then either
respond as the character or deny privileged actions without changing character.

## Temporary Stream Operators

Permission overrides can grant a narrow operational power without changing the
person's relationship to the character:

```js
registry.setPermissionOverride({
  userId: "fan_operator",
  permission: "delegate_work",
  effect: "allow",
  scope: "stream:youtube",
  reason: "temporary stream operator"
});
```

The user can help during a stream, but still remains a fan. This preserves the
character relationship model while supporting real operations.

Scoped overrides apply only to matching input contexts. A `stream:youtube`
override affects YouTube stream turns but does not change Discord or Slack
developer conversations.

## Dev Server Audience API

The built-in dev server can expose the audience registry for local tools,
admin panels, stream setup scripts, and Discord/YouTube fan management UIs.

```js
const server = createIroHarnessDevServer({
  harness,
  eventStream,
  userRegistry,
  adminToken: process.env.IROHARNESS_ADMIN_TOKEN
});
```

Available endpoints:

```text
GET   /audience
POST  /audience/users
PATCH /audience/users/:userId
POST  /audience/users/:userId/identities
POST  /audience/users/:userId/permissions
POST  /audience/stream-sessions
PATCH /audience/stream-sessions/:sessionId
```

Example: link the same developer across Discord and YouTube, then grant scoped
stream control:

```bash
curl -X POST http://127.0.0.1:4178/audience/users \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $IROHARNESS_ADMIN_TOKEN" \
  -d '{
    "id": "dev_1",
    "displayName": "Developer",
    "role": "developer",
    "relationship": "core-developer",
    "identities": { "discord": "DDEV" }
  }'

curl -X POST http://127.0.0.1:4178/audience/users/dev_1/identities \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $IROHARNESS_ADMIN_TOKEN" \
  -d '{
    "platform": "youtube",
    "platformUserId": "UCDEV",
    "displayName": "Dev Channel"
  }'

curl -X POST http://127.0.0.1:4178/audience/users/dev_1/permissions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $IROHARNESS_ADMIN_TOKEN" \
  -d '{
    "permission": "manage_stream",
    "effect": "allow",
    "scope": "stream:youtube",
    "reason": "trusted stream host"
  }'
```

Set `adminToken` whenever the dev server is reachable beyond a trusted local
machine. Requests may send either `authorization: Bearer <token>` or
`x-iroharness-admin-token: <token>`.

## Operational Pattern

In an OBS / YouTube / Discord setup:

1. Every incoming message is normalized by the platform adapter.
2. The actor is resolved through `iroharness_user_identities`.
3. The same character responds with the same personality.
4. Role permissions and scoped overrides decide whether the request can trigger
   private actions such as deep discussion or micro-harness delegation.
5. Public bodies such as OBS overlays, Live2D, MotionPNGTuber, M5Stack, or Even
   G2 receive expression state only; they do not own user authority.
