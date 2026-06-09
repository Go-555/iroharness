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

### 3.7 Runtime Hook Integration (`receive`): `turn:before`

The hardened `dispatch` (§6) is wired into the macro runtime so in-process hooks
actually run. `createIroHarness` accepts an optional `hooks` parameter — a
registry from `createHookRegistry`. When omitted it defaults to none, so existing
harnesses are unchanged. This phase wires the **first and most important** point,
`turn:before`; `tool:before` and `response:before` follow.

Inside `receive(input)`, **after the actor and audience are resolved** (the
route is already chosen by this point) and **before the `permissionPolicy.evaluate`
check**, the gate runs:

```js
if (hooks) {
  const result = await hooks.dispatch( // async since 7a (§3.9)
    "turn:before",
    { input, actor, audience, route },
    { protectedKeys: ["actor"] },
  );
  if (result.blocked) {
    return rejectByHook(input, route, actor, audience, result.reason);
  }
  input = result.context.input ?? input; // apply a transform of the input
}
```

- **`block` → reject.** A blocking hook stops the turn before permission, routing,
  delegation, or the brain. A new `rejectByHook` helper returns a denial result
  (mirroring `rejectByPermission`) carrying the hook's `reason`; it sets speaking
  state and emits a speech event like the permission-denial path.
- **`transform` → apply to `input` only.** A transform may rewrite `input` (e.g.
  moderation/normalization); the rewritten value flows downstream to
  `permissionPolicy.evaluate` and `brain.respond` (`input` is the `receive`
  parameter and is simply reassigned). Note the `input.text`/`modality`/`source`
  validation at the top of `receive` ran on the **original** input, so a
  transform-rewritten input is not re-validated — acceptable, since `transform`
  is moderation/normalization territory and the authz field (`actor`) is
  protected. `actor` is passed under `protectedKeys: ["actor"]`, so a hook
  **cannot forge the actor** to escalate (the §6 deep-freeze + protected-keys
  guard). `route` is **not** re-derived from a transform this phase (it is
  already chosen; re-routing mid-turn is deferred).
- **No hooks → unchanged.** With no `hooks` registry the dispatch is skipped
  entirely and `receive` behaves exactly as today.

**Trust model.** In-process hooks are **operator-authored, trusted** code (they
run inside the harness, like the brains and policies). `protectedKeys: ["actor"]`
guards the one thing a hook must not forge — the resolved **actor identity** —
against both transform-replacement and in-place mutation (the §6 deep-freeze;
an in-place forge attempt throws and fail-closes the turn). A transform **may**
legitimately rewrite `input`, and a downstream check (`permissionPolicy.evaluate`)
that reads the rewritten `input` will see the rewritten value — this is the
operator's hook doing its job, not an escalation by the external speaker, whose
identity (`actor`) is fixed. (`actorPermissions` and `contextScopes` are derived
**before** `turn:before`, so an `input` transform does not retroactively re-grant
permissions.)

**Hot-path optimization (a new `dispatch` change).** Add a no-handler
early-return to `dispatch` **before** the `freezeContext` call: when
`handlers.get(event)` is empty, return a cheap passthrough without the
`structuredClone`/deep-freeze. Since `receive` calls `dispatch` every turn, a
deployment with no `turn:before` hook then pays nothing.

### 3.8 Runtime Hook Integration (`receive`): `tool:before` and `response:before`

2a-B-ii wires the remaining two text-path gates the **same way** as `turn:before`
(§3.7): `if (hooks)` guards each dispatch, `protectedKeys: ["actor"]` is passed,
`block` denies via `rejectByHook`, the no-handler hot-path keeps hookless turns
free, and a no-`hooks` harness is unchanged.

**`tool:before`** fires just **before micro-harness delegation** — inside the
`if (route.kind === "work" && route.harnessId)` branch, before `runMicroHarness`:

```js
if (hooks) {
  const r = await hooks.dispatch( // async since 7a (§3.9)
    "tool:before",
    { input, actor, audience, route },
    { protectedKeys: ["actor"] },
  );
  if (r.blocked) return rejectByHook(input, route, actor, audience, r.reason);
  input = r.context.input ?? input;
}
return runMicroHarness(input, route, actor, audience, permission, actorPermissions, contextScopes);
```

- **`block` → deny** the delegation (a permission/policy hook stops the tool
  before it runs), via `rejectByHook`.
- **`transform` → rewrite `input`** only (`route` already chosen; same as
  §3.7). `actor` is protected.

**`response:before`** fires **after `brain.respond` and before the speech is
emitted**, so it can filter or rewrite the outgoing response:

```js
let response = await brain.respond({ ... });
if (hooks) {
  const r = await hooks.dispatch( // async since 7a (§3.9)
    "response:before",
    { input, actor, audience, route, response },
    { protectedKeys: ["actor"] },
  );
  if (r.blocked) return rejectByHook(input, route, actor, audience, r.reason);
  response = r.context.response ?? response;
}
// ...setState(speaking) + emit("speech", { text: response.text }) using the (possibly rewritten) response
```

- **`block` → suppress** the brain's response: it is not emitted; the turn is
  denied via `rejectByHook` (the character speaks the denial text instead). This
  is the response-moderation kill switch.
- **`transform` → rewrite `response`** (e.g. `response.text`) — the
  output-moderation case. The rewritten `response` is what gets emitted as speech
  and returned. `actor` remains protected; `response` is the new transformable
  field in this event's context.

Both reuse the existing `rejectByHook` helper and the hardened `dispatch`. The
only new wiring is threading `response` into the `response:before` context and
reading the result downstream (the `const response` becomes a `let`).

### 3.9 Command Runner (7a): async `dispatch` + child-process hook

Phase 7a makes a hook handler allowed to be **asynchronous** and adds the
**command** execution style (§3.2 style 2): a hook that runs an external program
under the JSON stdin/stdout contract. 7a ships the async change and the
`createCommandHook` factory with **direct registration**; the JSON manifest
loader and `matcher` are 7b.

**`dispatch` becomes async.** A child process is inherently asynchronous, and
running it synchronously (`execFileSync`) would stall the shared event loop —
including the realtime voice loop — for the child's duration. So `dispatch`
returns a `Promise` and `await`s each handler:

```js
for (const entry of entries) {
  let decision;
  try {
    decision = await entry.run(current); // in-process fn resolves immediately; command fn awaits the child
  } catch (error) {
    // unchanged: failModeFor(event) -> fail-closed (gate/unknown) or fail-open (background/realtime)
  }
  // ...block short-circuit / transform merge / protectedKeys — all unchanged
}
```

Everything else in `dispatch` is unchanged: the no-handler hot-path, the
`deepFreeze(structuredClone())` context isolation, the `failModeFor` fail
policy, the `protectedKeys` guard, and the post-transform shape semantics. An
async handler that **rejects** is caught by the same `try/catch` as a synchronous
throw and routed through `failModeFor`. Awaiting an in-process (synchronous)
handler costs one microtask (sub-millisecond), so the realtime budget is
unaffected; the realtime invariant (§3.5) still guarantees no child process is
ever registered on a realtime point, which is the actual latency protection.

This is a **breaking change to the `dispatch` contract** (sync → async). All
call sites `await`: the three `receive()` sites (§3.7/§3.8, already inside an
`async` function) and **every existing `dispatch` unit test** is retrofitted to
`await dispatch(…)` (its callback made `async`) — not just the new async tests.

**`createCommandHook(spec)`** (`extension/hook-runners/command.js`) returns an
`async (ctx) => decision` function registered like any handler with
`style: "command"` (the realtime invariant rejects that style on a realtime
event). `spec = { command, args = [], timeout = 5000, cwd?, env? }`:

- Validates the spec at construction: `command` is a non-empty string and `args`
  is an array of strings (otherwise `createCommandHook` throws at registration,
  not at dispatch — a misconfiguration surfaces at load time).
- Spawns `command` with `args` via a **non-shell** spawn (`shell: false`), so an
  argument can never be reinterpreted as a shell command — command injection is
  structurally impossible, not filtered. `cwd` defaults to `process.cwd()` (the
  harness working directory, Node's `child_process` default).
- Writes `JSON.stringify(ctx)` to the child's stdin and closes it. A child that
  exits before reading stdin raises `EPIPE` on the write; that error is **caught
  and rethrown as a hook error** so it lands in the same `try/catch` and routes
  through `failModeFor` (never an uncaught rejection).
- Collects stdout with a `spawn` `data`-event accumulator, **capped at 1 MiB**:
  when the running total exceeds the cap the child is killed and the call throws
  (a streaming cap, not `execFile`'s post-hoc `maxBuffer`).
- A **timeout** (default 5 s) kills the child with **`SIGKILL`** (not a polite
  `SIGTERM` an adversarial child could trap) and throws; a non-zero exit throws.
- Parses stdout as JSON and maps the §3.4 wire contract to the internal decision
  shape:
  - `{ "decision": "deny", "reason"? }` → `{ block: { reason } }`
  - `{ "decision": "allow", "transform"? }` → `{ transform }` when `transform`
    is a non-null object, else `undefined` (pass-through). An absent, `null`, or
    empty-object `transform` is pass-through; `reason` is ignored on `allow`.
  - unparseable stdout or an unrecognized `decision` → **throw**
- Every throw propagates to `dispatch`, where `failModeFor` decides the outcome:
  a command failure on a **gate** event (`turn:before`, `tool:before`,
  `response:before`, `memory:write`) **fails closed** (deny); on a **background**
  event (`turn:after`) it **fails open** (§6). The child's stdout is an
  **external trust boundary**, so it is validated here — consistent with the rule
  that validation lives at boundaries (external input / external programs), not
  between trusted in-process components.

**Security defaults (baked in, not optional):**

- **No shell** (`shell: false`) — the single most important control.
- **Minimal environment** — the child receives `{ PATH: process.env.PATH }` only
  by default (enough to locate an interpreter), never the parent's full
  `process.env`, so harness secrets (API keys, tokens) are not handed to operator
  hook programs. `spec.env` can explicitly extend this allow-list.
- **Bounded** — timeout + output cap prevent a hung or flooding child from
  stalling or exhausting the host.
- **stderr discarded** (`stdio: ["pipe", "pipe", "ignore"]`) — the child's stderr
  is ignored, so a noisy child cannot deadlock on a full (undrained) stderr pipe
  and no child output bleeds into the harness's own stderr.
- **Fail-closed on any doubt** — a missing, malformed, oversized, slow, or
  crashed child output denies on a gate event.

A symlinked `command` path that resolves to a different binary between
registration and spawn is an OS-level TOCTOU concern, but the hook program is
**operator-authored and within the operator's own trust domain** (the same actor
that writes the hook controls its filesystem), so 7a does not re-resolve or pin
the path; it is out of scope, not overlooked.

7a adds **no manifest loader and no `matcher`** (7b). A command hook is
registered directly: `register(event, createCommandHook(spec), { style: "command" })`.

### 3.10 Command Manifest (7b): JSON loader + `matcher`

Phase 7b adds the **declarative** front door for command hooks: a JSON manifest
(§3.4) whose entries are loaded and registered in bulk, each gated by a
`matcher`. It is purely additive — `dispatch` and `register` are unchanged; the
loader reuses 7a's `createCommandHook` and wraps each hook in a matcher gate.

**Manifest shape** (§3.4), command entries only in 7b:

```json
{
  "hooks": {
    "tool:before": [
      { "type": "command", "matcher": "codex", "command": "./hooks/audit.sh", "timeout": 5000 }
    ],
    "turn:before": [
      { "type": "command", "matcher": "stream|voice", "command": "./hooks/route.sh" }
    ]
  }
}
```

**`matcher` is a regex tested against a route-derived, per-event key.** The
`route` object is `{ kind, harnessId, reason }` (kind ∈ `stream`/`voice`/`deep`/
`text`/`work`; `harnessId` is the delegation target for a `work` route). The key:

- **`tool:before`** → `route.harnessId ?? ""` — the micro-harness being delegated
  to (the "tool name"; e.g. `codex`).
- **every other event** (`turn:before`, `response:before`, `turn:after`,
  `memory:write`, and any future text-path event) → `route.kind ?? ""`. This is a
  deliberate catch-all default: `tool:before` is the only event whose natural key
  is the delegation target; all others discriminate on the route kind. (A future
  event that needs a different key adds a branch to the resolver.)

An **absent matcher matches everything** (equivalent to `.*`); an **empty-string
matcher behaves the same** (an empty `RegExp` matches every key). The regex is
compiled **once at load**; at dispatch the loader's wrapper runs the underlying
command hook only when `re.test(keyFor(event, ctx))`, otherwise it returns
`undefined` (pass-through). The registry stays unaware of matching:

```js
const re = matcher ? new RegExp(matcher) : null;            // compiled at load
const gated = (ctx) =>
  !re || re.test(keyFor(event, ctx)) ? commandHook(ctx) : undefined;
registry.register(event, gated, { style: "command", priority });
```

Because registration uses `style: "command"`, the **realtime invariant (§3.5)
still rejects a manifest entry on a `bargein:`/`speech:`/`device:` event** at
load time.

**API.** `registerCommandManifest(registry, manifest, { baseDir = process.cwd() })`
takes a **parsed manifest object** (testable without the filesystem), validates
it, and registers every command hook, returning the registry. `command`
resolution follows `execvp` convention: a `command` that **contains a path
separator** (e.g. `./hook.sh`, `../hooks/x`, `/abs/x`) is a path and is resolved
against `baseDir`; a **bare name** (no separator, e.g. `node`, `bash`) is left
untouched for `PATH` lookup by `spawn`. A path that traverses out of `baseDir`
via `../` is within the operator's own filesystem trust domain (same posture as
§3.9's TOCTOU note) — 7b does not canonicalize or reject it. A thin
`loadCommandManifestFile(registry, path)` reads + `JSON.parse`s the file and
calls the core with `baseDir = dirname(path)`. Both are exported from `./extension`.

`priority` (if present on an entry) is passed to `register` as
`{ style: "command", priority }` — it is a registry ordering option, **not** a
`createCommandHook` spec field (§3.9's spec is `{command,args,timeout,cwd,env}`).

**Load-time validation (boundary check — fail loud, never a silent drop, §6).**
The manifest is operator-authored but is still external input (a JSON file), so
it is validated at load:

- An **absent `hooks` key is treated as `{}`** (zero hooks registered; not an
  error). If present, `manifest.hooks` must be an object and each event value
  must be an array; each array element must be a **non-null object** (a string/
  number/null element throws a load-time error naming the event and index).
- Each entry: `type` is required and must be `"command"`; `command` is a required
  non-empty string; `matcher` (if present) must be a **string** that compiles as a
  valid `RegExp` (a non-string or an uncompilable pattern throws); `timeout`/
  `args`/`cwd`/`env` are optional and validated by 7a's `createCommandHook`
  (args = string array, etc.); `priority` (optional) is a `register` option (see
  above).
- **`type: "agent"` is a clear load-time error** ("agent hooks are not supported
  until Phase 8") — not a silent skip.
- An invalid regex, an unknown/missing `type`, or any malformed entry throws a
  load-time error **naming the event and the entry index**, consistent with §6's
  "never a silent drop." A command hook on a realtime event surfaces the §3.5
  rejection. (Duplicate event keys within a single JSON object resolve by the
  parser's last-wins behavior, which is acceptable — the manifest is a single
  authored document.)

This keeps 7b's security surface at the boundary (the manifest file and the
child it names), reusing 7a's already-hardened spawn (shell-false, minimal env,
timeout, output cap, fail-closed). No agent runner (Phase 8).

## 4. Skills

**This section builds on the existing `src/skills/` subsystem.** IroHarness
already ships a skills system: `parseSkillFrontmatter` (SKILL.md parser),
`createFileSkillRegistry` (discovery + dedupe + sorted `snapshot()`),
`createSkillContextListing` (the compact listing injected into context), and
`readSkillInvocationContext` (body load on invocation), with its own metadata
axes (`purpose`, `trigger`, `shape`, `role`). Phase 2 does **not** rebuild any
of this. It adds the one thing the existing system lacks: **zero-trust gating
by view layer and actor capability.** What follows describes the format
adjustment and the gating delta only.

### 4.1 Format

A skill is a `SKILL.md` file with YAML frontmatter and a markdown body, parsed
by the existing `parseSkillFrontmatter`. That parser reads **flat** frontmatter
(`key: value` and `key:` lists) — it does not parse nested maps. The gating
fields are therefore **flat top-level keys**, not a nested block:

```yaml
---
name: stream-greeting               # existing: identifier
description: Greeting routine for stream start   # existing: when to use
view: trusted                       # NEW gating key: minimum view layer (public|trusted|owner)
capability: delegate_work           # NEW gating key: named capability the actor must hold (ties to §5)
requires: stream.enabled            # NEW gating key: a gating condition the runtime can evaluate
---
(markdown body: the instructions)
```

`name`, `description`, and the existing axes keep their current meaning, so
existing skills remain valid. The three new keys (`view`, `capability`,
`requires`) do not collide with **any** existing frontmatter key (the upstream
parser reads `name`, `description`, `purpose`, `trigger`, `shape`, `role`,
`kind`, `version`, `prefix`, `context`, `user-invocable`,
`disable-model-invocation`, `argument-hint`, `allowed-tools`, `agent`, `model`,
`base`, `pair`, `evaluator`, `inputs`, `outputs`, `references`). They are simply
absent on skills that do not opt into gating. **Gating fails closed:** an absent,
malformed, or unrecognized `view` resolves to `owner` (the most restrictive
layer) — `public` must be an explicit opt-in, so a skill authored without a
`view` is never silently exposed. View values are case-folded and alias-mapped
(`external`→`public`, `team`/`internal`→`trusted`) to match `normalizeVisibility`
in `bin/iroharness.mjs`. An absent `capability`/`requires` imposes no additional
restriction (the `view` gate still applies). Other runtimes ignore the keys they
do not recognize.

**Reading the gating keys without touching upstream internals.** The upstream
manifest builder (`skillManifestFromFrontmatter`) and its normalizer
(`normalizeSkillManifest`) are module-private and freeze a fixed field set, so
new keys added there would be dropped before reaching the manifest. Phase 2
therefore does **not** modify them. Instead `skill-gate.js` reads `view`,
`capability`, and `requires` directly from each skill's `SKILL.md` using the
**exported** `parseSkillFrontmatter` and the `manifestPath` the upstream
manifest already carries in `skill.metadata.manifestPath`. This keeps the delta
to a single new file and touches no upstream-private code.

### 4.2 Discovery

Discovery **reuses** `createFileSkillRegistry` and its existing roots —
repo-level built-in `skills/` (`defaultBuiltInSkillDir`), user-managed
`~/.iroharness/skills/` (`defaultIroHarnessSkillDir`), and app-local
`.iroharness/skills/`. The registry's `snapshot()` already collects, dedupes by
`id` (user-managed and app-local skills win over built-ins on an id collision),
and sorts; Phase 2 adds no new discovery mechanism and no new root. Note that
`snapshot()` re-reads the filesystem on each call, so `skill-gate.js` takes one
snapshot at session start and caches the eligible result for the session (§4.3)
rather than calling it repeatedly.

### 4.3 Gating and Injection

The new work is a **gating filter** inserted between the registry's skill list
and `createSkillContextListing`. Given the registry skills plus a session
context (current view layer + acting actor), it returns the **eligible** subset
by applying three checks, all of which must pass:

1. **View layer** — the skill's `view` must be visible from the session's
   current view layer (eligible iff `rank(session) >= rank(skill.view)`, with
   `public` < `trusted` < `owner`). A `public` session never sees `trusted` or
   `owner` skills. **Fail closed:** an absent/malformed/unrecognized skill `view`
   resolves to `owner` (deny by default); an unrecognized *session* view falls
   back to `public` (least privilege).
2. **Requires** — the skill's `requires` condition (config, environment,
   platform, binary presence) must hold. An absent `requires` always passes.
3. **Capability** — the acting actor must hold the named `capability` (§5
   Permissions Are Separate From Affection). This is a capability test (e.g.
   `delegate_work`, `manage_stream`), not a comparison against an ordered rank,
   because the permission model is non-linear. An absent `capability` imposes
   no restriction.

The eligible set is captured once at session start and reused for the session.
The existing `createSkillContextListing` then compiles that eligible set into
the compact block injected into the macro harness prompt — unchanged, it simply
receives a pre-filtered list. Invocation still goes through the existing
`readSkillInvocationContext`.

### 4.4 Zero-Trust View Integration

`iroharness view export --zone <zone>` already materializes a zone-scoped copy
of a companion (SOUL/identity/voice, memory layers, Project OS items, and
connection files, each filtered by zone). It does **not** yet materialize
skills. This integration adds skill materialization so a `public` export never
carries `trusted`/`owner` skills on disk — defense in depth beyond the runtime
gate of §4.3.

**Filtering is view-layer only.** A skill is materialized into a zone iff
`rank(skill.view) <= rank(zone)` (with `public` < `trusted` < `owner`):

- `--zone public` → only `view: public` skills.
- `--zone trusted` → `public` + `trusted` skills.
- `--zone owner` → all skills.

`capability` and `requires` are **not** applied at export time. They are runtime
gates (who may use a skill, under what conditions), not disk-presence decisions.
A `trusted` skill that also requires `delegate_work` is still written into the
`trusted` and `owner` views; its `capability`/`requires` checks run at session
start (§4.3) when the skill is actually loaded. Export answers "what may this
zone *see on disk*"; the runtime gate answers "what may *this actor* use now."

**Fail closed.** A skill whose `view` is absent, malformed, or unrecognized
resolves to `owner` (via the same normalizer as §4.1), so an un-annotated skill
is materialized only into the `owner` view — never silently exposed to a public
export.

**Single source of truth.** The skill `view` normalization (alias map +
fail-closed default) lives only in `src/skills/gate.js` and is reused by the
export path via `readSkillGating` (below), so the runtime gate (§4.3) and the
export cannot drift on how a skill's view is resolved. The rank comparison reuses
the existing `viewZoneRank` in `bin/iroharness.mjs` (identical `public` <
`trusted` < `owner` ladder already used by `canExposeProjectOsItem`).

**Mechanism.** A new `exportSkillFiles({ sourceRoot, targetRoot, zone, files })`
in `bin/iroharness.mjs` discovers the companion's skills — built-ins from
`defaultBuiltInSkillDir()` (the iroharness package's own `skills/`) and app-local
skills from `join(sourceRoot, ".iroharness", "skills")`, **not** the operator's
global `~/.iroharness/skills/` (e.g. via `createFileSkillRegistry`'s discovery).
For each skill it reads the **normalized** gating with the exported
`readSkillGating(skill)` (which runs `parseSkillFrontmatter` → `parseSkillGating`
→ `normalizeView`, so aliases like `external`/`team`/`internal` and the
fail-closed default are honored) and compares **only** `gating.view`:
`viewZoneRank[gating.view] <= viewZoneRank[zone]`. `capability`/`requires` are
ignored at export. (Do **not** use `gateSkills` with empty `permissions` for this
— it would wrongly exclude capability-gated skills.) Eligible skills' `SKILL.md`
plus their referenced resource files (the non-`SKILL.md` contents of
`skill.metadata.skillDir`, e.g. `references/`) are copied into
`current/skills/<id>/` via `cpSync(..., { recursive: true })` and added to the
view manifest. **Symbolic links and dotfiles/dot-dirs are dropped during the
copy** (a `filter` that rejects every `isSymbolicLink()` entry and every entry
whose basename starts with `.`, while always allowing the skill dir root): a
link inside an eligible lower-zone skill could otherwise dereference to
higher-zone content and smuggle it across the zone boundary, and dotfiles like
`.git`/`.env`/`.DS_Store` are repo metadata or stray secrets rather than skill
resources — so the copy fails closed and materializes neither. (Arbitrary
non-dotfile contents remain the skill author's responsibility; a strict resource
allowlist is a separate, larger design.)
Discovery lists app-local skills before built-ins and tracks seen ids, so a
skill id present in both roots is copied and listed exactly once (app-local
wins). The whole per-skill body is guarded, so a malformed `SKILL.md`, a
dangling symlink, or a permission error on one skill is skipped with a warning
(consistent with `gateSkills`) and never aborts the export. `exportView` calls
it alongside the existing `exportMemoryFiles`/`exportProjectOsFiles`.

Both layers then apply: presence on disk (this export filter) is necessary but
not sufficient; within a view the per-actor `requires`/`capability` checks still
run at session start (§4.3).

### 4.5 Runtime Integration (`receive`)

The gate of §4.3 is wired into the macro runtime so eligible skills actually
reach the brain. `createIroHarness` accepts an optional `skills` parameter — a
registry from `createFileSkillRegistry`. When omitted it defaults to none, so
existing harnesses are unchanged.

The gate runs **on the brain path only**, **per turn** (the acting actor can
differ between turns). The `work` and `stream` routes return early (via
`runMicroHarness`/`runStreamController`) before the brain responds and receive no
skill listing; the gating code sits immediately before `brain.respond`, after
those early returns:

```js
const satisfied = resolveSatisfiedRequirements(satisfiedRequirements, {
  input, actor, route, audience, state, permissions: actorPermissions, contextScopes,
});
const skillListing = skills
  ? createSkillContextListing({
      skills: gateSkills({
        skills: skills.list(),
        view: tierToView(audience.tier),
        permissions: actorPermissions,
        satisfiedRequirements: satisfied,
      }),
    })
  : Object.freeze([]);
// ... brain.respond({ ..., skills: skillListing })
```

`createFileSkillRegistry.list()` returns a **memoized snapshot** (computed once,
invalidated by `register()` or a new registry instance), so the per-turn call is
not an FS re-scan. The per-actor **filter** (`gateSkills`) is what varies by
actor. The eligible listing is passed to `brain.respond` as a new `skills` field.
Existing brains ignore unknown context fields, so the addition is non-breaking; a
brain that wants to use skills reads `context.skills`.

**`requires` is evaluated at runtime via `satisfiedRequirements`.** `createIroHarness`
accepts a `satisfiedRequirements` option — either a static `string[]` or a
per-turn `(context) => string[]` resolver — of the currently-met `requires`
conditions (config/environment/platform flags like `stream.enabled`). `receive()`
resolves it and passes it to `gateSkills`. Because this controls skill
visibility, resolution is **fail-closed**: a resolver that throws or returns a
non-array is treated as **none satisfied** (a `requires`-gated skill stays hidden,
the turn never crashes, a skill is never opened on error). The default `[]`
keeps the prior behavior (every `requires`-gated skill excluded). Skills without
a `requires` key are unaffected.

**Tier-to-view mapping.** The actor's audience `tier` maps to the view layer the
gate filters by:

| tier | view |
|---|---|
| `owner` | `owner` |
| `trusted` (developer) | `trusted` |
| `operator` (moderator) | `trusted` |
| `member`, `public`, `anonymous`, or any unrecognized tier | `public` |

The mapping **fails closed**: an unrecognized tier resolves to `public` (least
privilege). `operator` is granted `trusted` because a moderator's job (stream
operations) may rely on trusted-shelf operational playbooks; the owner controls
what lives on the trusted shelf. `capability`/`requires` are applied per actor by
the gate regardless of tier, so a tier that clears the view gate can still be
denied a specific skill it lacks the capability for.

This is the per-actor runtime layer. It composes with the disk-level view export
of §4.4 (a public-gateway deployment never has trusted/owner skills on disk in
the first place); the runtime gate is defense in depth for harnesses loaded from
a fuller skill set.

## 5. Module Boundaries

```
extension/
  hook-registry.js     register hooks, enforce the realtime invariant (§3.5),
                       hold priority/merge, dispatch on emit. Depends on: event bus.
  hook-runners/
    inprocess.js       (style 1) ctx -> decision, pure in-process call
    command.js         (style 2) spawn child process, JSON stdin/stdout contract
    agent.js           (style 3) LLM judgment, JSON decision
  skill-gate.js        filter the existing registry's skills by view layer,
                       capability, and requires -> eligible set. Reads the gating
                       keys from each SKILL.md via the exported
                       parseSkillFrontmatter + skill.metadata.manifestPath.
                       Depends on: src/skills/ (registry + parser), view layer,
                       permission. (NEW — the only skills code Phase 2 adds.)
```

Skills reuse the existing `src/skills/` subsystem (`parseSkillFrontmatter`,
`createFileSkillRegistry`, `createSkillContextListing`,
`readSkillInvocationContext`). Phase 2 adds only `src/skills/gate.js` (living
with the subsystem it extends, exported via the existing `./skills` entry) and
touches no upstream-private code: the gating keys are read through the exported
parser via the manifest's `manifestPath`, not by extending the private manifest
builder. There is no `skill-loader` or `skill-injector` — those roles already
exist upstream. The view-layer order (`public` < `trusted` < `owner`) mirrors
the existing zone list in `bin/iroharness.mjs`; the actor's held capabilities
are the `permissions` array from the audience context
(`createAudienceContextPolicy`), tested by membership.

Each unit has one purpose and a defined interface:

- `hook-registry` is the only place that knows the realtime invariant.
- The three runners share a `(ctx) -> decision` shape, so the registry dispatches
  uniformly regardless of style.
- `skill-gate` produces a pre-filtered eligible set that the existing
  `createSkillContextListing` consumes unchanged. It knows nothing about hooks.

## 6. Error Handling

- **Registry rejection** (§3.5): registering a disallowed style/event-point pair
  is a load-time error with a clear message, never a silent drop.
- **Command hook failure**: a non-zero exit, timeout, or unparseable stdout is
  treated as a configured `failClosed`/`failOpen` policy per event point.
  Gate-style points (`tool:before`, `memory:write`) default to fail-closed
  (deny on error); background points default to fail-open.
- **Agent hook failure**: model error or timeout follows the same fail policy as
  command hooks.
- **In-process handler throw**: `dispatch` wraps each handler call in a
  try/catch, so a throwing handler never crashes the loop. The fail mode is
  decided by `failModeFor(event)`:
  - **fail-closed** (throw → `block`) for **gate** events (`turn:before`,
    `tool:before`, `memory:write`, `response:before`) and **any unrecognized
    event** (default-closed for safety). The synthesized result uses the **same
    shape as a normal block decision** —
    `freezeCopy({ event, blocked: true, reason: "hook error (fail-closed): <message>", context: current })` —
    so callers read `result.blocked`/`result.reason` uniformly.
  - **fail-open** (throw → log a warning and skip that handler, continue) for
    **background** events (`tool:after`, `turn:after`) and all **realtime**
    events (`bargein:*`/`speech:*`/`device:*` — the realtime loop must never
    stall on a broken expression/barge-in hook).
- **A hook cannot forge authorization-bearing context fields.** Two paths are
  closed:
  - **In-place mutation.** The context handed to handlers is a **deep-frozen
    structural clone** (`deepFreeze(structuredClone(context))`), not a shallow
    freeze. A handler that tries to mutate a nested authz object (e.g.
    `ctx.actor.role = "owner"`) throws, and that throw is handled like any other
    failing hook (fail-closed `block` on gate events). The clone also isolates
    the caller's objects, so a forged value can never leak back into caller
    state. (A shallow freeze left nested objects mutable — the bypass this
    closes.)
  - **`transform` replacement.** `dispatch` takes a third options argument
    defaulting to a no-op — `dispatch(event, context = {}, { protectedKeys = [] } = {})`,
    so existing two-argument callers are unaffected. When `protectedKeys` is
    non-empty, `dispatch` drops any key a handler's `transform` tries to set that
    is listed in it (logging a warning).
  Together these mean a hook cannot escalate by setting `actor` (or any protected
  key) via either channel. The runtime wiring (2a-B) passes
  `protectedKeys: ["actor"]` for events whose context carries the resolved actor.
- **Skill parse failure**: a malformed `SKILL.md` is skipped with a logged
  warning and excluded from the eligible set; it never aborts session start.

## 7. Testing

- **hook-registry**: registering a `command`/`agent` hook on a realtime point is
  rejected; priority ordering; `block` short-circuit; `transform` merge order.
  Golden fixtures consistent with the existing `fixtures/golden/` approach.
- **hook-runners**: in-process as a pure function; command against a fixture
  script asserting the JSON contract; agent against a mocked model.
- **skill-gate**: fixtures with `public`/`trusted`/`owner` skills assert view
  gating, requires gating, and capability gating; **fail-closed defaults** (absent/
  malformed/unknown `view` => `owner`, including the owner-vs-trusted denial
  boundary; unknown session view => `public`; case-fold + alias normalization);
  absent `capability`/`requires` = no extra restriction; the pre-filtered set fed
  to `createSkillContextListing` excludes ineligible skills.
- **gating-key read**: `skill-gate` reads `view`/`capability`/`requires` from a
  skill's `SKILL.md` via the exported `parseSkillFrontmatter` and the manifest's
  `manifestPath`; a skill without the keys parses and defaults open. Upstream
  manifest/parse code is unchanged (no private functions touched).
- **error handling (2a-A, §8 step 5 — this phase for dispatch)**: the
  in-process throwing-handler catch + `failModeFor` per-event fail-closed/
  fail-open classification, and the `transform` `protectedKeys` guard, are tested
  on `dispatch` directly: a throwing handler on a gate event blocks (fail-closed,
  block-shaped result); on a background/realtime event it is skipped and the loop
  continues (fail-open); a `transform` targeting a protected key is dropped while
  other keys apply; and two-argument callers are unaffected. The
  malformed-`SKILL.md` skip is covered in Phase 2 (skill-gate, the
  `gateSkills excludes a malformed skill` test). Command/agent runner fail
  policies (child-process/LLM) land with those runners (later phases).

## 8. Phasing

1. Hook registry + in-process runner + realtime invariant (the backbone). **Done.**
2. Skill gating (`src/skills/gate.js`): view/capability/requires filter over the
   existing registry. **Done.**
3. Zero-trust view-export integration (§4.4): `exportSkillFiles` materializes
   only view-visible skills on export, view-layer only, fail-closed, sharing
   `gate.js`'s normalizer. **Done.**
4. Runtime skill integration (§4.5): wire `gateSkills` into
   `createIroHarness.receive()` (per-turn, tier-to-view), passing the eligible
   listing to `brain.respond`. The skill gate's first real consumer. **Done (2b).**
5. Dispatch hardening (2a-A, §6): add the throwing-in-process-handler catch +
   `failModeFor` per-event fail-closed/fail-open classification, and the
   `transform` `protectedKeys` guard, to `hook-registry.js` `dispatch`. **Done.**
6. Hook dispatch integration (2a-B): wire in-process `dispatch` into `receive()`
   (§3.7) — `dispatch`'s first real loop consumer, passing
   `protectedKeys: ["actor"]`. **2a-B: `turn:before`** (block→reject
   via `rejectByHook`, transform→apply to `input`) + the no-handler hot-path
   optimization in `dispatch`. **Done.** **2a-B-ii: `tool:before`** (block→deny
   delegation, transform→`input`) **and `response:before`** (block→suppress the
   brain output, transform→rewrite `response`), §3.8 — **Done.** All three
   in-process text-path hook points (`turn:before`/`tool:before`/`response:before`)
   are now wired into `receive()`.
7. Command runner (text-path child-process hook gates), §3.9. Split in two:
   - **7a (this phase):** make `dispatch` async (breaking change; all call sites
     `await`) and add the `createCommandHook` factory — spawn a child under the
     §3.4 JSON contract, `shell: false`, minimal env, timeout + output cap,
     fail-closed-on-doubt — registered directly via `register(..., { style:
     "command" })`). **Done.**
   - **7b (this phase):** the JSON manifest loader
     (`registerCommandManifest` + `loadCommandManifestFile`, §3.10) and `matcher`
     (regex against a route-derived per-event key — `route.harnessId` for
     `tool:before`, `route.kind` otherwise) that registers command hooks in bulk,
     with fail-loud load-time validation (no silent drop; `type:"agent"` errors
     until Phase 8). Reuses 7a's `createCommandHook`; `dispatch`/`register`
     unchanged. **Done.**
8. Agent runner (response review).

Note: the realtime invariant's coverage (device:emit, prefix/Set drift) is
hardened with tests as part of Phase 3, independent of the deferred fail policy.

Phase 1 delivered the latency-critical capability. Phase 2 adds skill gating as
a thin filter over the existing skills subsystem; later phases add the
text-path hook conveniences along the seam the backbone already establishes.
