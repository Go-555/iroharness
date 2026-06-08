# Extension Model: Hooks and Skills

Status: design (proposed)

This document specifies a native extension model for IroHarness covering two
surfaces: **hooks** (intercept lifecycle events) and **skills** (loadable
instruction packs). It is the result of comparing the extension models of Claude
Code and OpenClaw and adapting them to IroHarness's character-macro-runtime
constraints.

## 1. Goal and Scope

IroHarness should be able to intercept its own lifecycle (to stop speech on
barge-in, gate tool delegation, audit responses) and to load reusable
instruction packs (to teach the character repeatable workflows) **without
depending on an external agent runtime** to provide those capabilities.

In scope:

- A hook registry layered on the existing `emit`/`onEvent` event bus, upgrading
  observers into interceptors that can block or transform.
- Three hook execution styles, assigned by latency budget.
- A skill format borrowing `SKILL.md` + frontmatter, extended with IroHarness
  zero-trust gating.
- Skill discovery, gating, and prompt injection.

Out of scope (YAGNI for the first cut):

- Remote skill registry / publishing (ClawHub-style).
- Plugin packaging and distribution (npm/git/archive install).
- Provider hooks (model-provider lifecycle, 40+ hooks) — that is a
  model-plugin concern IroHarness does not need.
- A separate **Tools** layer — IroHarness already expresses callable work
  through the micro-harness `run(task, context)` contract; do not duplicate it.
- Cross-process event subscription — single process for now (Local First, §9).

## 2. Design Principle Revision

This design makes IroHarness a **self-contained runtime**: it owns its own agent
loop, hooks, and skills. This revises two existing principles:

- **§3 Micro Harnesses Are Delegated Workers** — IroHarness remains able to
  delegate to Codex, Claude Code, OpenClaw, and Hermes, but it is no longer
  *required* to delegate in order to intercept lifecycle or load skills. It can
  run these natively as a peer.
- **§7 Borrow Runtimes, Own The Boundary** — external runtimes become *usable*
  rather than *required*. IroHarness owns its extension surface natively.

The boundary discipline of §7 still holds for everything else: identity, state,
permission, routing, and body projection remain IroHarness's, and external
runtimes are still integrated through adapters rather than absorbed wholesale.

The realtime separation of **§6 Realtime Is A Replaceable Fast Path** is
*reinforced*, not revised: the hook design below is explicitly built along the
§6 seam between the realtime fast path and the stable JS contract layer.

## 3. Hooks

### 3.1 The Latency Backbone

Hook execution style is chosen by **latency budget**, which in practice tracks
the voice-vs-text divide:

- The **voice / realtime path** (speech, barge-in, device/expression sync) is
  hard real-time. A hook here must finish before the next audio frame — on the
  order of tens of milliseconds. Only in-process execution qualifies.
- The **text / non-realtime path** (chat turns, tool delegation, response
  review, memory writes) already operates on the order of seconds, like a coding
  agent. Here the safety, decoupling, and AI-judgment benefits of out-of-process
  and LLM hooks are worth their latency cost.

The precise rule is "must this hook complete before the next realtime frame?"
The voice-vs-text split is the practical proxy and is correct in the common
case; realtime-path hooks that can be deferred run asynchronously off the loop.

### 3.2 Three Execution Styles

1. **In-process (`api.on`)** — registered in code via `register(api)`, runs
   inside the IroHarness process. Sub-millisecond. The only style permitted on
   realtime event points.
2. **Command** — declared in a JSON manifest. Spawns a child process, passes the
   event context as JSON on stdin, reads a JSON decision on stdout. Tens of
   milliseconds. Text path only.
3. **Agent** — declared in the same manifest with an LLM prompt and model. Runs
   an LLM judgment. Hundreds of milliseconds to seconds. Text path only, for
   tasks that require AI judgment (e.g. "is this response in character / safe?").
   An agent hook may return either a `deny` decision or a `transform` that
   rewrites the payload, so `response:before` can both reject and rewrite an
   out-of-character response.

### 3.3 Event Points

| Path | Event | Default style | Purpose |
|---|---|---|---|
| voice (immediate) | `bargein:detect` | in-process | stop current speech on user interruption |
| voice (immediate) | `speech:before`, `speech:chunk` | in-process | expression / mouth-movement sync, pre-utterance shaping |
| voice (immediate) | `device:emit` | in-process | gate or shape a device/expression event |
| text (gate) | `turn:before` | command (or in-process) | normalize/moderate/route an incoming turn |
| text (gate) | `tool:before`, `tool:after` | command (or in-process) | permission check and audit around micro-harness delegation |
| text (gate) | `memory:write` | command (or in-process) | policy check before a memory write |
| text (judgment) | `response:before` | agent | AI review of an outgoing response |
| both (background) | `turn:after` | command/agent, async | logging, notification, post-hoc audit (observe only) |

### 3.4 Hook Contract

In-process handler:

```js
register(api) {
  // returns: undefined (pass) | { block: { reason } } | { transform: { ... } }
  api.on("bargein:detect", (ctx) => ({ block: { reason: "user interrupted" } }))
  api.on("tool:before", (ctx) => (ctx.actor.canDelegateWork ? undefined : { block: { reason: "denied" } }))
}
```

The actor in `ctx.actor` carries the resolved capability booleans
(`canDeepDiscuss`, `canDelegateWork`, `canManageStream`, ...) produced by the
existing permission model. Gating is **capability-based, not a linear rank**:
the permission model is non-linear (a `moderator` can manage a stream but cannot
delegate work; a `developer` can delegate work but cannot manage a stream), so
hooks test a named capability rather than comparing an ordered permission value.

- Handlers receive a frozen context object and return a decision.
- `block` stops the action and carries a reason. `transform` replaces fields of
  the event payload. Returning `undefined` passes through.
- Multiple handlers on one event run in **priority order**; a `block` short-
  circuits the rest. `transform` results are **merged** in priority order before
  the next handler sees the context.

Manifest (command / agent):

```json
{
  "hooks": {
    "turn:before": [
      { "matcher": "stream-.*", "type": "command", "command": "./hooks/route.sh", "timeout": 5000 }
    ],
    "response:before": [
      { "matcher": ".*", "type": "agent", "prompt": "Is this in character and safe? Reply JSON.", "model": "haiku", "timeout": 30000 }
    ]
  }
}
```

- `matcher` is a regex tested against an event-specific key (e.g. tool name,
  skill name, route id).
- Command hooks exchange JSON: context in on stdin, `{ "decision": "deny" | "allow", "reason"?, "transform"? }` out on stdout.
- Agent hooks return the same JSON decision shape from the model.

### 3.5 Registry Invariant (the safety device)

The hook registry **rejects registration of a `command` or `agent` hook on a
realtime event point** (`bargein:*`, `speech:*`, `device:*`). This makes it
physically impossible to put a multi-second LLM call inside the barge-in loop,
enforcing the §6 seam in code rather than by convention. Registration of a
disallowed combination is an error surfaced at load time, not a silent drop.

### 3.6 Relationship to the Existing Event Bus

The registry sits **on top of** the existing `emit`/`onEvent` bus. It does not
replace it. Today `emit(event)` fans out to `onEvent` observers; the registry
upgrades that fan-out so that, for registered event points, handlers run in
priority order and their `block`/`transform` decisions are applied before the
emitting code proceeds. Event points with no registered hooks behave exactly as
today (observe only).

## 4. Skills

### 4.1 Format

A skill is a `SKILL.md` file with YAML frontmatter and a markdown body. The
frontmatter borrows the Claude Code / OpenClaw fields for ecosystem
compatibility and adds an IroHarness extension block:

```yaml
---
name: stream-greeting               # borrowed: identifier
description: Greeting routine for stream start   # borrowed: when to use
metadata:
  iroharness:
    view: trusted                   # extension: minimum view layer (public|trusted|owner)
    requires: { config: "stream.enabled" }   # extension: gating condition
    capability: delegate_work       # extension: named capability the actor must hold (ties to §5)
---
(markdown body: the instructions)
```

`name` and `description` carry the same meaning as in Claude Code and OpenClaw,
so existing skills are reusable. Everything IroHarness-specific lives under
`metadata.iroharness` and is ignored by other runtimes.

### 4.2 Discovery

Skills are discovered by locating `SKILL.md` files in priority-ordered roots;
on a name collision the highest-priority source wins:

1. Workspace skills
2. Project skills
3. Personal skills
4. Managed/local skills
5. Bundled skills
6. Extra directories

The folder layout is organizational only; the `name` frontmatter field is the
identifier.

### 4.3 Gating and Injection

At session start the loader captures the **eligible** skill set by filtering on
three conditions, all of which must pass:

1. **View layer** — the skill's `metadata.iroharness.view` must be visible from
   the session's current view layer. A `public` session never sees `trusted` or
   `owner` skills. **Gating fails closed:** an absent/malformed/unrecognized
   skill `view` resolves to `owner` (the most restrictive layer), so `public`
   is an explicit opt-in and a skill is never silently exposed. (Phase 2
   refines this; see the reconciled §4 once it lands.)
2. **Requires** — `metadata.iroharness.requires` gating conditions (config,
   environment, platform, binary presence) must hold.
3. **Capability** — the acting actor must hold the named capability in
   `metadata.iroharness.capability` (§5 Permissions Are Separate From Affection).
   This is a capability test (e.g. `delegate_work`, `manage_stream`), not a
   comparison against an ordered rank, because the permission model is
   non-linear.

The eligible set is captured once at session start and reused for the session.
Eligible skills are compiled into a compact block injected into the macro
harness prompt.

### 4.4 Zero-Trust View Integration

Skill view gating reuses the existing zero-trust view export. `iroharness view
export --zone public` materializes only `public`-visible skills, matching how
view export already redacts core paths and restricts memory layers. A public
gateway therefore never receives owner-only skills on disk, not merely at
prompt-injection time.

The disk-level view filter and the runtime gating of §4.3 are both applied:
presence on disk (view export) is necessary but not sufficient. Within a view,
the per-actor `requires` and `capability` checks still run at session start, so
a skill materialized in a trusted view is still withheld from an actor who lacks
its required capability.

## 5. Module Boundaries

```
extension/
  hook-registry.js     register hooks, enforce the realtime invariant (§3.5),
                       hold priority/merge, dispatch on emit. Depends on: event bus.
  hook-runners/
    inprocess.js       (style 1) ctx -> decision, pure in-process call
    command.js         (style 2) spawn child process, JSON stdin/stdout contract
    agent.js           (style 3) LLM judgment, JSON decision
  skill-loader.js      discover SKILL.md, parse frontmatter, apply view/requires/
                       capability gating -> eligible set. Depends on: view layer, permission.
  skill-injector.js    compile eligible skills into a prompt block. Depends on: skill-loader.
```

Each unit has one purpose and a defined interface:

- `hook-registry` is the only place that knows the realtime invariant.
- The three runners share a `(ctx) -> decision` shape, so the registry dispatches
  uniformly regardless of style.
- `skill-loader` produces a plain eligible set; `skill-injector` consumes it.
  Neither knows about hooks.

## 6. Error Handling

- **Registry rejection** (§3.5): registering a disallowed style/event-point pair
  is a load-time error with a clear message, never a silent drop.
- **Command hook failure**: a non-zero exit, timeout, or unparseable stdout is
  treated as a configured `failClosed`/`failOpen` policy per event point.
  Gate-style points (`tool:before`, `memory:write`) default to fail-closed
  (deny on error); background points default to fail-open.
- **Agent hook failure**: model error or timeout follows the same fail policy as
  command hooks.
- **In-process handler throw**: caught by the registry; the throwing handler is
  treated as a fail-closed `block` on gate points and skipped on background
  points, with the error logged. A throwing handler never crashes the loop.
- **Skill parse failure**: a malformed `SKILL.md` is skipped with a logged
  warning and excluded from the eligible set; it never aborts session start.

## 7. Testing

- **hook-registry**: registering a `command`/`agent` hook on a realtime point is
  rejected; priority ordering; `block` short-circuit; `transform` merge order.
  Golden fixtures consistent with the existing `fixtures/golden/` approach.
- **hook-runners**: in-process as a pure function; command against a fixture
  script asserting the JSON contract; agent against a mocked model.
- **skill-loader**: fixtures with `public`/`trusted`/`owner` skills assert view
  gating, requires gating, capability gating, and name-collision precedence.
- **skill-injector**: the injected block differs by view layer and excludes
  ineligible skills.
- **error handling**: the hook fail policy — fail-closed vs fail-open per event
  point, and the throwing-in-process-handler catch that keeps the loop alive —
  lands with the command runner in **Phase 3** (it needs the gate/background
  event-point taxonomy), so it is not a Phase 1 test (see §8). The
  malformed-`SKILL.md` skip is covered in Phase 2 (skill-gate).

## 8. Phasing

1. Hook registry + in-process runner + realtime invariant (the backbone).
2. Skill loader + injector + view/permission gating.
3. Command runner (text-path gates).
4. Agent runner (response review).

Phase 1 delivers the latency-critical capability; later phases add the text-path
conveniences along the seam the backbone already establishes.
