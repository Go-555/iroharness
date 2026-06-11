# Platform Adapters

Platform adapters normalize messages from chat platforms into IroHarness turns.

They do not own personality. They only translate platform payloads into:

```json
{
  "source": "discord",
  "modality": "text",
  "text": "こんにちは",
  "actor": {
    "platform": "discord",
    "platformUserId": "123456",
    "displayName": "Fan One"
  },
  "metadata": {}
}
```

The macro harness then resolves the actor through the user registry, checks
permissions, routes the request, updates PJOS, and emits character state.

## Stream Context

Use `createStreamContextEnricher` when a platform turn should be associated with
a live stream session before permissions run.

```js
import {
  createSnapshotStreamSessionResolver,
  createStreamContextEnricher
} from "iroharness/adapters";

const enrichTurn = createStreamContextEnricher({
  resolveStreamSession: createSnapshotStreamSessionResolver({
    snapshot: () => userRegistry.snapshot()
  })
});
```

The resolver matches the turn platform plus channel metadata such as
`liveChatId`, `channelId`, or `streamChannelId` against `streamSessions`. When a
session matches, it adds:

```json
{
  "metadata": {
    "streamSessionId": "youtube_stream_1",
    "streamPlatform": "youtube",
    "streamChannelId": "live_1"
  }
}
```

This enables scoped permission rules like `streamSession:youtube_stream_1` and
keeps public stream behavior separate from private developer workflows.

## Discord

Use `createDiscordMessageAdapter` for Discord message payloads.

```js
import { createDiscordMessageAdapter } from "iroharness/adapters";

const discord = createDiscordMessageAdapter({
  mentionOnly: true,
  botUserId: "iroha-bot-user-id"
});

const turn = discord.normalize({
  id: "message_1",
  channel_id: "channel_1",
  guild_id: "guild_1",
  content: "<@iroha-bot-user-id> こんにちは",
  author: {
    id: "discord-user-1",
    username: "Fan One"
  },
  mentions: [{ id: "iroha-bot-user-id" }]
});
```

For a real Discord Gateway bot runtime, use `createDiscordBotRuntime`:

```js
import {
  createDiscordBotRuntime,
  createDiscordMessageAdapter
} from "iroharness/adapters";

const runtime = createDiscordBotRuntime({
  token: process.env.DISCORD_BOT_TOKEN,
  harness,
  adapter: createDiscordMessageAdapter({
    mentionOnly: true,
    botUserId: process.env.DISCORD_BOT_USER_ID
  })
});

runtime.start();
```

Or run the example:

```bash
DISCORD_BOT_TOKEN=... DISCORD_BOT_USER_ID=... npm run example:discord
```

The runtime uses Discord Gateway messages, turns `MESSAGE_CREATE` into an
IroHarness turn, and replies through Discord's Create Message REST endpoint.
In production, enable the bot intents needed for message events and message
content.

The built-in dev server accepts normalized Discord-like payloads:

```bash
curl -X POST http://127.0.0.1:4178/platform/discord/message \
  -H 'content-type: application/json' \
  -d '{
    "id": "message_1",
    "channel_id": "channel_1",
    "content": "Codexで設計をレビューして",
    "author": {
      "id": "discord-developer",
      "username": "Developer"
    }
  }'
```

## Slack

Use `createSlackMessageAdapter` for Slack Events API payloads.

```js
import { createSlackMessageAdapter } from "iroharness/adapters";

const slack = createSlackMessageAdapter({
  mentionOnly: true,
  botUserId: "UIROHA"
});

const turn = slack.normalize({
  team_id: "T123",
  event: {
    type: "app_mention",
    user: "U123",
    channel: "C123",
    ts: "1710000000.000100",
    text: "<@UIROHA> こんにちは",
    user_profile: {
      display_name: "Developer"
    }
  }
});
```

For Slack Events API handling plus thread replies, use
`createSlackEventsRuntime`:

```js
import {
  createSlackEventsRuntime,
  createSlackMessageAdapter
} from "iroharness/adapters";

const runtime = createSlackEventsRuntime({
  botToken: process.env.SLACK_BOT_TOKEN,
  harness,
  adapter: createSlackMessageAdapter({
    mentionOnly: true,
    botUserId: process.env.SLACK_BOT_USER_ID
  })
});

await runtime.handlePayload(slackEventsPayload);
```

To receive the same payloads over Slack Socket Mode (wss, no public HTTP
endpoint, Node 22+), pair `createSlackSocketModeBridge` with the same
runtime — see [slack-codex.md](./slack-codex.md#socket-mode-no-public-endpoint).

Or run the example:

```bash
SLACK_BOT_TOKEN=... SLACK_BOT_USER_ID=... npm run example:slack
```

For a Slack-facing companion that delegates coding work to Codex through the
host machine's Codex OAuth session, see [slack-codex.md](./slack-codex.md):

```bash
codex login
SLACK_BOT_TOKEN=... SLACK_SIGNING_SECRET=... IROHARNESS_RUN_CODEX=1 npm run example:slack-codex
```

The built-in dev server accepts Slack Events-like payloads:

```bash
curl -X POST http://127.0.0.1:4178/platform/slack/message \
  -H 'content-type: application/json' \
  -d '{
    "event": {
      "type": "app_mention",
      "user": "U123",
      "channel": "C123",
      "text": "<@UIROHA> こんにちは"
    }
  }'
```

## YouTube Live Chat

Use `createYouTubeLiveChatAdapter` for YouTube live chat message resources.

```js
import { createYouTubeLiveChatAdapter } from "iroharness/adapters";

const youtube = createYouTubeLiveChatAdapter();
const turn = youtube.normalize({
  id: "chat_1",
  snippet: {
    liveChatId: "live_1",
    displayMessage: "こんにちは"
  },
  authorDetails: {
    channelId: "UC123",
    displayName: "Viewer"
  }
});
```

For a real live chat polling loop, use `createYouTubeLiveChatPollingRuntime`:

```js
import { createYouTubeLiveChatPollingRuntime } from "iroharness/adapters";

const runtime = createYouTubeLiveChatPollingRuntime({
  apiKey: process.env.YOUTUBE_API_KEY,
  liveChatId: process.env.YOUTUBE_LIVE_CHAT_ID,
  harness,
  turnEnricher: enrichTurn,
  onResult({ turn, result }) {
    console.log(turn.actor.displayName, turn.text, result.kind);
  }
});

runtime.start();
```

Or run the example:

```bash
YOUTUBE_API_KEY=... YOUTUBE_LIVE_CHAT_ID=... npm run example:youtube
```

The built-in dev server accepts YouTube-like payloads:

```bash
curl -X POST http://127.0.0.1:4178/platform/youtube/message \
  -H 'content-type: application/json' \
  -d '{
    "id": "chat_1",
    "snippet": {
      "liveChatId": "live_1",
      "displayMessage": "こんにちは"
    },
    "authorDetails": {
      "channelId": "UC123",
      "displayName": "Viewer"
    }
  }'
```

## Audience Management Endpoints

When the dev server is created with `userRegistry`, local admin tools can manage
the shared audience table that Discord, YouTube, Slack, browser, VS Code, and
device turns resolve through. Set `adminToken` to require
`authorization: Bearer <token>` or `x-iroharness-admin-token: <token>` for these
routes.

```text
GET   /audience
GET   /audience/resolve?platform=youtube&platformUserId=UC123
POST  /audience/users
PATCH /audience/users/:userId
POST  /audience/users/:userId/identities
POST  /audience/users/:userId/permissions
DELETE /audience/users/:userId/permissions?permission=...&scope=...
POST  /audience/stream-sessions
PATCH /audience/stream-sessions/:sessionId
```

Use this for stream setup, fan/member role management, and linking platform IDs
to one durable person before permissions and personality routing run.
`/audience/resolve` is a preflight check for stream operators: paste a YouTube,
Discord, Slack, browser, or VS Code identity and confirm whether it resolves to
the expected user before the public event starts.

## Why This Layer Exists

Discord, YouTube, Slack, and future platforms should all become the same macro
input shape before they touch personality or work delegation. This keeps the
character stable while each platform remains replaceable.
