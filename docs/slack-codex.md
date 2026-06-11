# Slack + Codex Companion

This recipe runs IroHarness as a Slack-facing macro harness and delegates coding
work to Codex through `codex app-server`.

It can also use Codex OAuth for the main text brain, so normal Slack
chat and deep discussion can run on a selected Codex model while coding work is
still delegated through a separate micro harness path.

## Authentication Model

Use two separate auth layers:

1. Slack auth: `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` let the companion
   receive Slack Events API payloads and post thread replies.
2. Codex OAuth: run `codex login` on the host machine. The Codex app-server
   process uses that local OAuth session. IroHarness does not ask every Slack
   user for a Codex login.
3. Model selection: set `IROHARNESS_TEXT_BRAIN_MODEL` and `CODEX_MODEL`
   separately. The first picks the character brain model; `CODEX_MODEL` picks the delegated coding
   worker model.

Slack users are authorized through the IroHarness audience registry. A Slack
user must be registered as `developer` or `owner`, or be granted
`delegate_work`, before their Slack message can trigger Codex.

This keeps the character identity and permissions in the macro harness while
Codex remains a delegated micro harness.

## Run Locally

First authenticate Codex on the Mac mini or host that will run the companion:

```bash
codex login
codex doctor
```

Then start the Slack + Codex companion:

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
SLACK_BOT_USER_ID=UIROHA \
IROHARNESS_RUN_CODEX=1 \
IROHARNESS_TEXT_BRAIN_PROVIDER=codex \
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.5 \
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER \
CODEX_WORKSPACE=/path/to/project \
npm run example:slack-codex
```

The example listens on:

```text
http://127.0.0.1:4181/slack/events
```

Expose that endpoint with Tailscale Serve, Cloudflare Tunnel, ngrok, or another
trusted ingress. Put the public HTTPS URL into Slack's Events API Request URL.

## Socket Mode (no public endpoint)

If you set `SLACK_APP_TOKEN`, the example connects to Slack over Socket Mode
(outbound wss) instead of starting the HTTP listener. No tunnel, reverse
proxy, or public Request URL is needed — the only network exposure is an
outbound connection from your machine to Slack.

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
SLACK_BOT_USER_ID=UIROHA \
IROHARNESS_RUN_CODEX=1 \
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER \
CODEX_WORKSPACE=/path/to/project \
npm run example:slack-codex
```

How to create the `xapp-` token:

1. In your Slack app settings, open **Basic Information → App-Level Tokens**
   and generate a token with the `connections:write` scope. It starts with
   `xapp-`.
2. Enable **Socket Mode** for the app (Settings → Socket Mode).
3. Subscribe to the same events as the HTTP path (`app_mention`, optionally
   `message.channels` / `message.groups`). No Request URL is required.

Notes:

- `SLACK_SIGNING_SECRET` is not used in Socket Mode. Request signing is an
  HTTP Events API concept; Socket Mode authenticates through the `xapp-`
  token when opening the connection.
- Socket Mode needs the native `WebSocket` global, so run the example on
  **Node 22+**. The package itself still supports Node >=20 for everything
  else; the bridge raises a clear error on older runtimes (or inject
  `openConnection` with your own WebSocket implementation).
- Slack may redeliver the same event (`retry_attempt` on the envelope, or a
  duplicate delivery around connection refreshes). The bridge acks every
  envelope and leaves dedupe to the caller; the example reuses the same
  `event_id` dedupe as the HTTP path.
- Slack periodically sends `disconnect` frames to refresh connections. The
  bridge opens the replacement connection before closing the old one and
  reconnects with capped exponential backoff after unexpected drops.

For library use, wire `createSlackSocketModeBridge` to the existing events
runtime — the envelope payload has the same shape as an Events API request
body:

```js
import {
  createSlackEventsRuntime,
  createSlackSocketModeBridge
} from "iroharness/adapters";

const runtime = createSlackEventsRuntime({ botToken, harness });
const bridge = createSlackSocketModeBridge({
  appToken: process.env.SLACK_APP_TOKEN,
  handleEvent: (payload) => runtime.handlePayload(payload)
});
await bridge.start();
// later: bridge.close();
```

## Slack App Settings

Minimum Slack app setup:

- Bot Token Scopes:
  - `app_mentions:read`
  - `chat:write`
  - `channels:history` if you want public-channel message events
  - `groups:history` if you want private-channel message events
- Event Subscriptions:
  - `app_mention`
  - optionally `message.channels` or `message.groups`
- Request URL:
  - `https://your-host.example/slack/events`

`iroharness connect slack` writes the same setup as a local checklist at
`.iroharness/connections/slack-onboarding.md`.

By default, the example uses `mentionOnly: true`, so normal channel messages are
ignored unless the bot is mentioned. Set `SLACK_MENTION_ONLY=0` only in trusted
channels.

## Permission Setup

The fastest local path is:

```bash
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER npm run example:slack-codex
```

That registers `UOWNER` as `owner` in `.iroharness/users.json`.

For more users, use the audience CLI:

```bash
npx iroharness audience user . \
  --id dev_keita \
  --display-name "Keita" \
  --role developer \
  --slack U123

npx iroharness audience grant . \
  --user dev_keita \
  --permission delegate_work \
  --reason "trusted developer"
```

Fans can still chat, but cannot trigger Codex unless `delegate_work` is granted.

## Message Flow

```text
Slack mention
  -> Slack signature verification
  -> IroHarness Slack adapter
  -> audience registry resolves slack:U...
  -> text route uses Codex app-server brain with selected model
  -> permission policy checks delegate_work for work routes
  -> work route uses Codex app-server micro harness with selected worker model
  -> Slack thread reply
  -> PJOS records ticket, run, and artifact metadata
```

## Important Boundary

Codex OAuth authenticates the machine's Codex app-server process. It is not a
replacement for Slack workspace auth, Slack user identity, or IroHarness
permissions.

If a Slack user asks for coding work and is not trusted, IroHarness should deny
the delegation before Codex is called.

The main Codex brain defaults to read-only sandboxing and `approvalPolicy:
"never"`. It is meant for conversation and reasoning. File edits belong to the
Codex micro harness path.
