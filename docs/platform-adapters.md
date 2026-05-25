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

## Why This Layer Exists

Discord, YouTube, Slack, and future platforms should all become the same macro
input shape before they touch personality or work delegation. This keeps the
character stable while each platform remains replaceable.
