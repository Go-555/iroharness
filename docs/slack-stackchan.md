# Slack + StackChan Companion

This recipe runs one IroHarness character through Slack and a StackChan-style
M5Stack face at the same time.

It is the recommended first hardware experiment:

- Slack is the text interface.
- IroHarness owns identity, memory, permissions, routing, and Project OS.
- StackChan is a body renderer that reads the current character state.
- Codex can be added later as a text/deep brain or delegated micro harness.

## Current Maturity

This is usable for a local prototype. It is not yet a polished production
product.

Good now:

- Slack Events API input and thread replies
- StackChan face JSON polling
- StackChan Server-Sent Events stream
- shared character state between Slack and StackChan
- optional Codex OAuth model use through `codex app-server`

Still early:

- no bundled StackChan firmware
- no built-in STT/TTS on the M5Stack device
- no device-side reconnect/backoff helper yet
- no OTA or provisioning flow yet

## Run Locally

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
SLACK_BOT_USER_ID=UIROHA \
IROHARNESS_SLACK_OWNER_USER_ID=UOWNER \
npm run example:slack-stackchan
```

The example prints:

```text
Slack Events URL: http://127.0.0.1:4182/slack/events
StackChan face JSON: http://127.0.0.1:4182/stackchan/face
StackChan SSE: http://127.0.0.1:4182/body/stackchan/events
```

Expose `/slack/events` with Tailscale Serve, Cloudflare Tunnel, ngrok, or
another trusted HTTPS ingress and set it as Slack's Events API Request URL.

## StackChan Polling Contract

The simplest StackChan firmware can poll:

```text
GET /stackchan/face
```

Response:

```json
{
  "face": ":D",
  "mode": "speaking",
  "text": "Irohaとして受け取ったよ。"
}
```

Face values are intentionally tiny:

| Mode | Face |
|---|---|
| `idle` | `:)` |
| `listening` | `o_o` |
| `thinking` | `...` |
| `speaking` | `:D` |
| `working` | `>_>` |
| `error` | `x_x` |

For a richer relay, subscribe to:

```text
GET /body/stackchan/events
```

That endpoint streams the same body payloads as Server-Sent Events.

## Optional Codex OAuth

For normal text/deep replies through Codex OAuth:

```bash
codex login

IROHARNESS_TEXT_BRAIN_PROVIDER=codex \
IROHARNESS_TEXT_BRAIN_MODEL=gpt-5.4 \
IROHARNESS_DEEP_BRAIN_PROVIDER=codex \
IROHARNESS_DEEP_BRAIN_MODEL=gpt-5.5 \
npm run example:slack-stackchan
```

For delegated coding work:

```bash
codex login

IROHARNESS_RUN_CODEX=1 \
CODEX_WORKSPACE=/path/to/project \
CODEX_MODEL=gpt-5.4 \
npm run example:slack-stackchan
```

The two paths are separate. The text/deep brain is read-only conversation. The
Codex micro harness is where file edits, reviews, and implementation work
belong.

## Permission Boundary

Slack users are resolved through the IroHarness audience registry. A user must
be `owner`, `developer`, or explicitly granted `delegate_work` before work can
be delegated to Codex.

StackChan does not grant permissions. It only renders the character state.
