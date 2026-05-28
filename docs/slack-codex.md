# Slack + Codex Companion

This recipe runs IroHarness as a Slack-facing macro harness and delegates coding
work to Codex through `codex app-server`.

It can also use Codex OAuth for the main text/deep brain slots, so normal Slack
chat and deep discussion can run on a selected Codex model while coding work is
still delegated through a separate micro harness path.

## Authentication Model

Use two separate auth layers:

1. Slack auth: `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` let the companion
   receive Slack Events API payloads and post thread replies.
2. Codex OAuth: run `codex login` on the host machine. The Codex app-server
   process uses that local OAuth session. IroHarness does not ask every Slack
   user for a Codex login.
3. Model selection: set `IROHARNESS_TEXT_BRAIN_MODEL`,
   `IROHARNESS_DEEP_BRAIN_MODEL`, and `CODEX_MODEL` separately. The first two
   pick the character brain models; `CODEX_MODEL` picks the delegated coding
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
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.4 \
IROHARNESS_DEEP_BRAIN_PROVIDER=codex \
IROHARNESS_DEEP_BRAIN_MODEL=gpt-5.5 \
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
  -> text/deep route uses Codex app-server brain with selected model
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
