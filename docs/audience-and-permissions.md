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
