# Architecture

IroHarness is a character macro harness.

It is designed around three layers:

```text
Macro Harness
  decides what to do, owns identity, manages user relationship and state

Project OS
  stores goals, specs, tickets, runs, artifacts, decisions, and memory links

Micro Harnesses
  execute specialized work such as coding, research, review, or automation
```

## Runtime Flow

```text
Human input
  -> interface adapter
  -> macro harness
  -> router
  -> brain or micro harness
  -> PJOS update
  -> character state update
  -> device/body adapters
```

The browser demo uses the same path:

```text
POST /turn
  -> IroHarness.receive()
  -> state/speech/task events
  -> EventStreamDevice
  -> GET /events
  -> browser avatar renderer
```

## Model Switching

The macro harness can route across model classes:

```text
voice-fast   short replies, low latency, barge-in friendly
text-deep    higher quality text reasoning
work         delegates to Codex, Claude Code, OpenClaw, Hermes, or others
```

The switch does not define identity. Identity belongs to the character instance.

## Body Expression

Every device receives normalized state:

```text
listening | thinking | speaking | working | idle | error
```

Renderer adapters decide how that state appears:

- Live2D pose and mouth movement
- MotionPNGTuber image state
- M5Stack pixel face
- Even G2 display text
- Slack/Discord text response
- VS Code sidebar companion

The core never hardcodes a renderer. Bodies subscribe to state and translate it
into their own display language.

## OpenClaw and Hermes

OpenClaw and Hermes are treated as integration targets, not the center of the
identity model. They can be powerful micro harnesses or peer characters.

This is the key distinction:

```text
OpenClaw/Hermes owns an agent runtime.
IroHarness owns the character macro runtime.
```

## Rust Boundary

The first implementation is Node.js to keep adapters easy to write.

A future Rust core should own:

- audio stream routing
- VAD/interruption loops
- WebSocket fanout
- device state synchronization
- expression scheduler

The macro contract should remain language-neutral.
