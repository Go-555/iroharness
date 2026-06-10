# Agent Bank & The Hanaita Orchestration Model

> **Status:** Draft proposal — 2026-06-05. Not yet implemented.
> This document captures a design direction, not shipped behavior. It extends
> [design-principles.md](./design-principles.md) (esp. #1 Identity, #3 Delegated
> Workers, #7 Borrow Runtimes Own The Boundary) and
> [architecture.md](./architecture.md).

## 1. Summary

IroHarness today connects a **fixed roster** of micro harnesses (Codex, Claude
Code, OpenClaw, Hermes) that are explicitly registered. This proposal adds two
capabilities on top of that, without changing the identity layer:

1. **Dynamic specialists** — Iroha can spin up a specialized sub-agent on demand
   when an incoming task needs expertise that no registered worker covers.
2. **Agent Bank** — specialists that prove useful are *evaluated, kept, and
   reused* across sessions. Mediocre ones decay. The bank is a curated registry
   of winners, not a flat config list.

The mental model is a sushi counter:

- **Iroha _is_ the Hanaita** (花板, the lead chef who runs the counter). One
  identity. She decides everything, serves guests, and — when a request is heavy
  — consults her regulars.
- **Sub-agents are the regulars** (常連) seated at the counter: a tax advisor, a
  lawyer, an engineer. The Hanaita asks them for knowledge while she works.
- **Agent Bank is the regulars' ledger** (常連名簿). Good regulars get invited
  back; ones who stop being useful fade from the book.
- **Guests outside the noren** (the actual requesters — owner, viewers, team)
  reach Iroha through platform adapters (voice / text / chat).

> Two kinds of "customer" exist; keep them distinct. **Guests outside the noren**
> = the people placing requests (owner/viewers). **Regulars at the counter** =
> sub-agents Iroha borrows expertise from.

## 2. Why this is needed

The fixed-roster model has three linked weaknesses:

| # | Weakness of fixed roster | What it needs |
|---|---|---|
| 1 | **Brittle to unknown tasks** — if a request needs a capability no registered worker has, work stalls until a human adds one. IroHarness spans many channels; incoming demand is not fully predictable. | Dynamic generation |
| 2 | **Bounded by human imagination** — a human only registers roles they think of. A generated team can reach into adjacent expertise the operator never anticipated. | Generation diversity |
| 3 | **Waste if generation alone** — generating from scratch every time yields uneven quality and burns tokens. | Agent Bank (retain & reuse) |

All three are required together. Generation without retention is wasteful;
retention without evaluation hoards mediocrity.

**When it is _not_ needed:** if a deployment's tasks are stable and known, the
fixed roster is enough. The value of this proposal scales with how much
*unpredictable* work actually arrives. That is the gating question.

## 3. Fit with the existing architecture

IroHarness already owns the substrate this needs — this is the strongest reason
the model fits:

| Concept needed | Already present in IroHarness |
|---|---|
| A place to store the regulars' ledger | **Project OS** (`goals/specs/tickets/runs/artifacts/decisions`) |
| Signal for "did this specialist do well?" | **`runs`** (outcome) + **`artifacts`** (quality) |
| A sandbox to try an unproven specialist | **Work Runner** (scoped workspace, privileged-work boundary) |
| A gate before granting a specialist power | **`work-runner-policy.json`** (public can't delegate; trusted needs permission; owner can, runner-only) + Audience visibility |
| Keeping identity unaffected by N workers | **Macro harness owns identity** (design-principle #1) |

The two pieces this proposal must add itself — because no existing tool provides
them (see §4) — are **performance evaluation** and a **promotion/retention
registry**.

## 4. Prior art: what Claude Code and OpenClaw already do

Research summary (2026-06-05). Both give us spawn + isolation + permission
scoping for free. **Neither provides evaluation or a retention registry** — that
is precisely the Agent Bank's reason to exist.

| Aspect | Claude Code | OpenClaw |
|---|---|---|
| Specialist definition | `.claude/agents/*.md` (YAML frontmatter + body: `name`, `description`, `tools`, `model`, `memory`, …) | `openclaw.json` (`agents.list[]`) + workspace markdown (`AGENTS.md`, `SOUL.md`) |
| Dispatch | `Agent` tool, auto-delegation or @-mention, parallel, background | `sessions_spawn` (async) + `sessions_yield`; concurrency lane (default 8) |
| Isolation | Fresh context per sub-agent; result returns as summary; optional git worktree | `isolated` / `fork` context; ACP runs in separate OS process + workspace |
| **Runtime generation** | **Not supported** — must be predefined files | **Partial** — not self-authored mid-turn, but `openclaw agents add --json` can create & persist a new agent out-of-band |
| Reuse / persistence | File-based; `memory:` scope; resumable via `SendMessage` | Sub-agent runs are ephemeral (archived ~60 min); top-level agents persist as a flat config list |
| **Scoring / keep-the-good-ones** | **None — build it yourself** | **None — build it yourself** |
| Permission scoping | tool allow/deny, hooks validation, `permissionMode` | monotonic narrowing chain; per-agent sandbox + auth store |

**Implication for the boundary (design-principle #7):** OpenClaw is the better
*generation substrate* because it can persist a new agent at runtime via
`agents add --json`; Claude Code cannot create agents at runtime (a host would
have to write `~/.claude/agents/<id>.md` before a session). IroHarness keeps the
**evaluation + promotion** layer regardless of which runtime is borrowed.

## 5. Architecture: a sandwich

```
Iroha (group HQ)              -- face, identity, audience, HR evaluation
   |  delegate_goal(...)
   |
   ├─ Hanaita orchestration   -- Iroha's own "in the back" decision-making
   │      |  picks regulars, routes, slices context, verifies, aggregates
   │      ├─ OpenClaw co.      -- "software-dev subsidiary" (its PM spawns staff)
   │      ├─ Codex co.         -- coding contractor
   │      └─ Research co.      -- research contractor
   │
   └─ Agent Bank (HR dept.)   -- evaluated ledger of useful regulars
```

- **Sheath = IroHarness's own micro-harness abstraction** (the adapter contract,
  see [build-an-adapter.md](./build-an-adapter.md)). One contract fits every
  subsidiary, so no lock-in.
- **Filling = borrowed runtimes** (OpenClaw / Codex / Claude Code). Don't rebuild
  an agent runtime; they already have spawn/yield/sandbox.
- **Evaluation = HQ (Agent Bank)** stays in IroHarness. Each subsidiary's score
  card is owned by HQ, not the subsidiary.

The "OpenClaw = a software-development company" framing is the intended usage:
one OpenClaw instance is a subsidiary whose internal PM runs its staff
(sub-agents) to complete one assignment, while Iroha (HQ) only places the order
and evaluates the result.

## 6. Iroha = Hanaita: one identity, not a separate persona

The Hanaita is **not a second agent**. It is Iroha doing her job. There is no
hand-off to a different personality; the orchestration carries Iroha's read of
the guest directly.

### 6.1 Channel and "ask the regulars?" are orthogonal axes

Earlier framing wrongly bound orchestration to brain slots (`deep`/`work`). It is
not slot-bound. Whether Iroha consults regulars (i.e. delegates) is a **judgment
Iroha makes per request**, independent of the input channel:

| Iroha's move | When |
|---|---|
| **Serve it herself** (answer directly) | small talk, immediate answers, her own domain |
| **Ask the regulars** (delegate) | needs expertise, heavy, needs verification |

So `text` can absolutely run in "Hanaita mode," and `voice` can too — but not
*every* turn needs it. Iroha decides.

### 6.2 Asynchronous, channel-crossing delegation

Heavy work delegated from a low-latency channel returns later, possibly on a
different channel — exactly how a human says *"got it, I'll message you the
details later."*

- `voice` is latency-critical → never run heavy work synchronously there. On a
  heavy request: acknowledge immediately ("I'll look into it and get back to
  you"), run the delegation asynchronously, return the result on `text` (or the
  next voice turn).
- This maps directly to `delegate_goal` being async (`sessions_spawn` /
  `sessions_yield`).

### 6.3 What stays separated even though identity is unified

- **Context** — orchestration's intermediate chatter (spawns, blackboard reads,
  verification logs) must NOT pollute Iroha's identity/memory context. Keep it in
  the brain slot's working context + the Project OS blackboard.
- **Failure** — if heavy orchestration fails, Iroha's face must still recover
  gracefully ("one moment, please").
- **Permission** — Hanaita work runs near the Work Runner (privileged, isolated).
  The public-facing face and the privileged orchestration keep separate
  context/permission. The zero-trust line is not dissolved.

## 7. How separated specialists collaborate on one goal

The hard part — isolation vs. cooperation — resolves into three mechanisms:

1. **Sliced context** — each specialist wakes with a *fresh, isolated* context
   (OpenClaw `isolated` / CC fresh context). It receives only the cut it needs
   (the tax regular gets the transactions; the research regular gets the
   question), never the whole conversation. Minds are not mixed.
2. **A shared blackboard** — specialists do not chatter peer-to-peer. They post
   **finished artifacts** to **Project OS**, and read others' *confirmed* results
   there. **Separate the thinking, share the plate.**
3. **The Hanaita as the vertical thread** — a star topology. The Hanaita assigns
   slices, verifies outputs (via `mekiki`=quality, `bantou`=permission), and
   decides the next move. Specialists connect only to the Hanaita, mediated by
   the blackboard.

Collaboration shapes:
- **Pipeline** — A → blackboard → B → blackboard → …; each gets only the prior
  confirmed result.
- **Fan-out / fan-in** — independent sub-problems delegated concurrently, then
  aggregated.
- **Verification loop** — Hanaita has results checked; on failure, send back;
  repeat until consensus or an iteration cap.

### Three wallets of memory (mirrors AutoAgents short/long/dynamic)

| Wallet | Holds | Counter analogy |
|---|---|---|
| Short-term | each specialist's working context (isolated, volatile) | one chef's hands |
| Long-term | Project OS blackboard (confirmed, persistent, shared) | the counter's board |
| Dynamic | Hanaita slices from the board per specialist | the cut the chef is handed |

## 8. Agent Bank: how the ledger is managed

Split by the nature of the data — the same split IroHarness already uses (memory
= markdown; Project OS = Postgres):

| | Holds | Read by | Stored as |
|---|---|---|---|
| **Résumé** | role, expertise, prompt/spec, origin | a human, by eye | **markdown file** |
| **Score card** | calls, success rate, last-used | a machine, aggregated | **ledger (Postgres / Project OS)** |

### Folder shape (résumé side)

```
.iroharness/
  agent-bank/
    _index.md
    staging/         # on trial (new regular)
      <id>/recipe.md
    active/          # regular (reused)
      <id>/recipe.md
    archived/        # retired (kept for reference, never deleted)
      <id>/recipe.md
```

### A recipe (résumé) — markdown + frontmatter

```markdown
---
id: tax-accountant-v3
role: Japanese tax & accounting specialist
born_from: ticket-0421
created: 2026-05-20
status: active            # staging | active | archived
visibility: trusted       # public | trusted | owner
toolset: [spreadsheet-read, tax-table-lookup, doc-write]
runner_scope: trusted-workspace
security_review: passed (bantou 2026-05-21)
quality_score: 4.6/5
stats_ref: pjos://agent-stats/tax-accountant-v3
---

## Role / Goal / Constraints
...

## Why kept
First minted on ticket-0421; 95% agreement with human on expense
classification; reused on 3 tasks, all successful → promoted.
```

### Score card (ledger)

```
agent-stats
  id                | calls | success | last_used  | avg_score
  tax-accountant-v3 |   4   |   4     | 2026-06-01 |   4.6
```

### Promotion lifecycle = folder moves

```
new request
  → Hanaita mints specialist → staging/        (trial)
  → run in Work Runner; bantou (permission) + mekiki (quality) check
  → meets threshold (e.g. ≥3 calls, ≥80% success, quality ≥4.0)
                                → active/       (promotion = "kept")
  → unused for N days (e.g. 30) → archived/     (retire; recoverable)
```

- **"Keep" decided by reuse value (累積), not a single lucky success.**
- Promotion in tool terms = writing a persistent definition:
  OpenClaw `agents add --json`; Claude Code `~/.claude/agents/<id>.md`.
- The **scoring + promotion brain is the Agent Bank's job** — the piece no
  existing tool provides.

> **Security invariant (bantou):** a `staging` specialist must NOT hold
> `visibility: owner` or vault-grade tools. Powers widen only after promotion and
> a passing `security_review`. This ordering is non-negotiable.

## 9. Tool surface

### Layer 1 — what Iroha holds (minimal)

```
delegate_goal(goal, context_ref, visibility)
  → one call. Team-formation → execution → verification → aggregation happen
    behind it; only a summary returns. Async (sessions_spawn / sessions_yield).
check_progress(run_id)      # optional
recall(role)                # optional: summon a known regular by name
```

### Layer 2 — what the Hanaita holds (hidden from the face)

```
ask_bank(task) -> recipe[]          # match active regulars
mint_specialist(spec) -> recipe     # generate a new one → staging
spawn(recipe, slice)                # start, hand it a context slice
collect(run_ids) -> results         # aggregate (sessions_yield)
post_to_board(item)                 # write to Project OS
verify(item)                        # mekiki (quality) + bantou (permission)
score_and_promote(run_id)           # record + promotion decision
```

## 10. Cast

| Name | Identity | Role |
|---|---|---|
| **Iroha = Hanaita** | macro harness (one persona) | runs the counter; judges, serves, orchestrates; consults regulars when heavy |
| **Regulars** | sub-agents (inside a borrowed runtime) | per-domain experts; good ones enter the Agent Bank |
| **Blackboard** | Project OS | confirmed artifacts, shared |
| **Regulars' ledger** | Agent Bank | résumé (md) + score card (ledger); staging/active/archived |
| **Guests outside the noren** | owner / viewers | requesters via voice / text / chat |
| **mekiki / bantou** | Observers | quality check / permission check |

## 11. Open questions & risks

- **Generation quality assurance** — a generated specialist may not actually work
  when wired up. Requires sandbox verification in the Work Runner before its
  output is trusted.
- **Permission × dynamic generation** — the central security risk (bantou).
  Inherit-creator-scope or isolate; never grant a `staging` specialist owner
  power. Prior art (CC/OpenClaw) gives no template here — own it.
- **Subsidiary internal PM** — the per-runtime PM (the second-tier "板長" inside
  e.g. OpenClaw) is currently unnamed. Candidate: *wakiita* (脇板).
- **Promotion thresholds** — concrete numbers (calls / success rate / quality /
  decay window) are placeholders; tune against real `runs` data.
- **Credit assignment** — when a team succeeds, attributing the win to one
  specialist is the classic multi-agent difficulty; lean on reuse-frequency over
  single-run attribution.

## 12. Provenance

Distilled from *AutoAgents: A Framework for Automatic Agent Generation*
(Chen et al., 2023, arXiv:2309.17288) — dynamic agent generation, Planner +
Observer roles, short/long/dynamic memory — and adapted to IroHarness's
one-identity, borrow-the-runtime-own-the-boundary philosophy. The paper's
proposed-but-unbuilt "Agent Bank" is the part IroHarness is positioned to
realize, because Project OS + Work Runner + work-runner-policy already supply the
ledger, sandbox, and permission gate.
