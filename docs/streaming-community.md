# Streaming And Community Operations

IroHarness is designed so the same character can appear in a stream, a Discord
community, a developer chat, and a physical device without becoming a different
person.

The invariant is:

```text
personality stays in the macro harness
platform IDs resolve to users
roles and scoped permissions decide access
OBS, YouTube, Discord, and devices are interfaces
```

## Target Shape

```text
YouTube Live Chat ----+
Discord Server   -----+--> platform adapter
Slack / VS Code  -----+--> user registry
M5Stack / Even G2 ----+--> permission policy
Browser / OBS    -----+--> IroHarness macro character
                           |
                           +--> voice/text/deep brain
                           +--> Codex / Claude Code / OpenClaw / Hermes
                           +--> PJOS
                           +--> body renderers and OBS overlay
```

The user registry is the table layer that keeps one person stable across
platforms:

```text
iroharness_users
iroharness_user_identities
iroharness_permission_overrides
iroharness_stream_sessions
```

Use `iroharness_user_identities` to link `youtube`, `discord`, `slack`,
`vscode`, `browser`, `m5stack`, `even-g2`, and future device identities to the
same user.

## Stream Setup

1. Run a companion server with a `userRegistry`.
2. Add the browser overlay to OBS:

```text
http://127.0.0.1:4178/?view=overlay
```

3. Start YouTube live chat polling with `YOUTUBE_API_KEY` and
   `YOUTUBE_LIVE_CHAT_ID`.
4. Start the Discord runtime with `DISCORD_BOT_TOKEN`.
5. Register the stream in `streamSessions` so scoped permissions can target the
   event:

```js
registry.createStreamSession({
  id: "youtube_stream_1",
  platform: "youtube",
  platformChannelId: process.env.YOUTUBE_LIVE_CHAT_ID,
  title: "IroHarness Dev Stream",
  hostUserId: "user_owner"
});
```

## Roles

Recommended defaults:

| Role | Purpose | Permissions |
|---|---|---|
| owner | project owner / operator | chat, deep discussion, delegate work, manage stream, manage users |
| developer | trusted collaborator | chat, deep discussion, delegate work |
| moderator | stream or community operator | chat, deep discussion, manage stream |
| member | known community member | chat, deep discussion |
| fan | public participant | public chat |
| anonymous | unknown visitor | public chat |

This gives fans a real relationship with the character while keeping stream
control and development work protected.

## Scoped Powers

Use permission overrides for temporary or context-specific access:

```js
registry.setPermissionOverride({
  userId: "trusted_fan",
  permission: "manage_stream",
  effect: "allow",
  scope: "streamSession:youtube_stream_1",
  reason: "guest moderator for one stream"
});
```

The user remains a fan. Only the scoped power changes.

Useful scopes:

```text
global
platform:discord
stream:youtube
streamSession:youtube_stream_1
```

## Developer Conversations

Deep design discussion and micro-harness delegation should be permissions, not
separate personalities.

```text
fan on YouTube
  -> public chat, short answer, no work delegation

developer in Discord
  -> deep discussion, PJOS access, Codex/Claude/OpenClaw/Hermes delegation

moderator during stream
  -> stream operation, OBS overlay/scene control, no code delegation by default
```

The character can adjust depth and action rights from `audience`, but the
`SOUL.md`, memory, macro harness behavior, and character state remain the same.

## OBS And YouTube

OBS should be treated as a body and stream-control interface, not as the source
of personality.

Allowed operations are routed through the macro harness as `stream` requests and
require `manage_stream`:

```text
scene changes
overlay URL updates
mute/unmute
stream layout changes
```

YouTube live chat is an audience input. It should normalize to an IroHarness
turn with:

```json
{
  "source": "youtube",
  "actor": {
    "platform": "youtube",
    "platformUserId": "UCxxx",
    "displayName": "Viewer"
  },
  "metadata": {
    "liveChatId": "youtube_live_chat_id"
  }
}
```

After stream context enrichment, the same permission policy can apply
`stream:youtube` or `streamSession:<id>` rules.

## Discord Multi-Person Fan Rooms

Discord is the best place for many-to-one and many-to-many fan interaction.
Run the Discord runtime in mention-only mode for public channels, and resolve
every message through the same registry used by YouTube:

```text
discord:12345 -> user_keita -> developer permissions
discord:99999 -> fan_99999  -> public chat permissions
```

For private developer channels, grant `deep_discussion` and `delegate_work` to
developer users. For public fan channels, keep `delegate_work` denied.

## Human-Likeness Boundary

Human-likeness comes from continuity, timing, expression, and relationship.
The system should therefore keep these stable:

- same character profile and memory across platforms
- same user identity resolution before model selection
- consistent body state across OBS, browser, M5Stack, Even G2, Live2D, and VRM
- different response depth by permission, not by changing the character
- low-latency voice brain for speech and deeper text/work brains for trusted
  discussion

This lets a public stream feel alive while still allowing developers to have
serious architecture discussions with the same character in a protected channel.
