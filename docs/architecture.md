# Architecture

IroHarness is a character macro harness.

The design rules are summarized in
[design-principles.md](./design-principles.md).

It is designed around three layers:

```text
Macro Harness
  decides what to do, owns identity, manages user relationship and state

Project OS
  stores goals, specs, tickets, runs, artifacts, decisions, and memory links

Micro Harnesses
  execute specialized work such as coding, research, review, or automation
```

For zero-trust deployments, those layers run behind explicit gateway and view
boundaries:

```text
Core SSOT
  owns SOUL, memory, policy, skills, users, and source connection records

View Export
  materializes only the files a zone is allowed to see

Public Gateway
  handles YouTube, X, and public chat from a public view only

Trusted Gateway
  handles Slack, StackChan, and private team channels from a trusted view

Work Runner
  handles Codex, OpenClaw, browser control, and repo work in scoped workspaces
```

The Work Runner is a responsibility boundary, not necessarily a separate
physical machine. It may run on the same Mac mini or PC as the Core SSOT, but
public or trusted gateways should not receive direct access to full local files,
repository credentials, browser sessions, or the host's Codex OAuth session.

Confirmed implementation detail: Codex OAuth is used through the local
`codex app-server` process on a host that has already run `codex login`. When
Codex is used as a text/deep brain, prefer read-only sandboxing. Coding,
editing, review, repository work, and other privileged operations should be
delegated through a micro harness / Work Runner with explicit permissions and a
scoped workspace.

Browser control is listed here as the intended privileged-work boundary. Treat
it like repository work: the gateway should pass a task, while the runner owns
the browser/session access inside its scoped environment.

The initial CLI support for this boundary is:

```bash
iroharness view export ./my-companion --zone public --out /Users/iroharness-public/iroha-view
iroharness view export ./my-companion --zone trusted --out /Users/iroharness-trusted/iroha-view
```

Generated views contain a `current/view-manifest.json` allowlist and a separate
`state/` directory for logs and proposals. They do not copy `.env`, firmware
secrets, root/core memory, or the whole `.iroharness/` runtime directory. The
exported `MEMORY.md` is generated from allowed memory layers such as
`memory/public.md`, `memory/trusted.md`, and `memory/owner.md`.

Project OS is also exported as a zone-filtered work board. Items without an
explicit `metadata.visibility` are owner-only by default. Public views only see
public tickets, runs, and artifacts; trusted views see public and trusted work;
owner views see the full work board.

Human metaphor:

```text
Iroha
  = the principal person with stable identity, relationship memory, and policy

Gateways
  = reception desks that decide who is talking and what room they may enter

Views
  = prepared folders of documents the receptionist is allowed to show

Project OS
  = the work board: goals, specs, tickets, runs, artifacts, and decisions

Micro Harness Workers
  = other specialists, like Codex, OpenClaw, Hermes, and Claude Code
```

Those workers can help Iroha do work, but they are not Iroha. They are delegated
specialists who receive scoped tasks and return results to Project OS.

## Runtime Flow

```text
Human input
  -> interface adapter
  -> actor identity resolution
  -> permission policy
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

## Audience And Permissions

IroHarness separates personality from access control.

```text
same Iroha
  + public fan on YouTube    -> public chat
  + member in Discord        -> deeper conversation
  + developer in Discord     -> deep design discussion + work delegation
```

The macro harness resolves platform identities through a user registry. A user
can have `youtube`, `discord`, `slack`, `browser`, and other IDs on the same
record. Permission checks happen before privileged actions such as micro-harness
delegation.

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
