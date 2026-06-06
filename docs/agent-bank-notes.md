# Agent Bank — Implementation Notes (Phase 0 足場確認)

> Working notes for Plans.md Phase 0. Source of truth for design = `agent-bank.md`.
> Read from `src/index.js` and `src/adapters/index.js` on branch `feat/agent-bank`
> (base: main @0aec133).

## 0.1 Project OS API (`src/index.js`)

Core: `createProjectOsStore(initialState, persist)` @114. Immutable snapshot store
(arrays frozen, append-only). Factories:
- `createInMemoryProjectOs()` @739
- `createFileProjectOs({ path })` @743 — JSON file persistence (load + persist)
- `createProjectOsMarkdown(snapshot)` @1376 — markdown renderer

Returned API (frozen):

| Method | Signature | Returns |
|---|---|---|
| `createTicket` | `{title, purpose, acceptance[], ownerCharacterId, executorHarnessId, metadata}` | ticket `{id, status:"open", createdAt, updatedAt, metadata, ...}` |
| `updateTicket` | `(ticketId, patch)` | ticket |
| `createRun` | `{ticketId, harnessId, input}` | run `{id, status:"running", output:null, createdAt, updatedAt}` |
| `completeRun` | `(runId, output, status="completed")` | run |
| `addArtifact` | `{ticketId, runId, kind, uri, title}` | artifact `{id, createdAt, ...}` |
| `snapshot` | `()` | `{tickets, runs, artifacts}` |

### Key findings for Agent Bank
- **`runs` carry `harnessId` + `status`** → the ledger (calls / success) can be
  **derived by aggregating runs grouped by `harnessId`**. No separate writable
  stats store needed. (Addresses W-4: specialists cannot inflate their own score
  because runs are written by the Hanaita via `createRun`/`completeRun`, not by
  the specialist.)
- `status` taxonomy: `"running"` → `"completed"` (or custom e.g. `"failed"` via
  `completeRun(id, output, status)`). success = `status === "completed"`.
- **quality signal**: `artifacts` (kind/uri/title) per run. `avg_score` needs a
  place — propose storing a numeric score in `run.output` (e.g.
  `output.qualityScore`) or an artifact of `kind: "score"`. → decide in Phase 2.1.
- `ticket.metadata` is free-form → **`visibility` lives here** (matches
  architecture.md "items without explicit metadata.visibility are owner-only").

## 0.2 Adapter / micro-harness contract (`src/adapters/index.js`)

A micro-harness = frozen object `{ capabilities: string[], run(task, context) }`.
- `run(task, context)` is async. `task = {id, title, purpose, metadata:{workspace,...}}`,
  `context = {character, actor, projectOs, input, ...}`.
- `buildDefaultMicroHarnessPrompt({task, context, label})` @47 builds the prompt.
- Factories: `createCodexAppServerMicroHarness` @560 (`capabilities:["code","files","review"]`),
  `createScopedWorkRunnerMicroHarness` @678, `createHttpMicroHarness` @2321,
  `createOpenClawMicroHarness` @2374.
- **Scoped Work Runner** @678 takes `{allowedWorkspaces[], capabilities}` and
  `scopeWorkspace({task, context})` @705 resolves a requested workspace via
  `resolveRequestedWorkspace` @231 (`task.metadata.workspace` etc.) and rejects
  paths outside `allowedWorkspaces`.

### Key findings for Agent Bank
- recipe → specialist mapping: **recipe.toolset → `capabilities`**,
  **recipe prompt → run() prompt** (reuse `buildDefaultMicroHarnessPrompt`).
- **B-4 receptacle**: persistence/exec must go through
  `createScopedWorkRunnerMicroHarness` with `allowedWorkspaces` set to the recipe's
  `runner_scope`. host-global dirs are simply never in `allowedWorkspaces`.
- **5.3 receptacle**: workspace rejection already exists; delegate_goal must route
  privileged work through the scoped runner, not a raw harness.

## 0.3 recipe / ledger placement (decision)

- **recipe (résumé)**: files under `.iroharness/agent-bank/{staging,active,archived}/<id>/recipe.md`
  (markdown + frontmatter). Outside git, inside the runtime home.
- **ledger (score card)**: **derived view over Project OS `runs`** (aggregate by
  `harnessId`), NOT a separate writable store. A thin `bank/ledger.js` computes
  calls/success/last_used/avg_score from a Project OS snapshot on demand.
  Persistence piggybacks on `createFileProjectOs`.
- **visibility vocabulary**: reuse `ticket.metadata.visibility` values
  (`public | trusted | owner`) so recipe visibility maps 1:1 to existing audience
  visibility. (To be reflected in agent-bank.md §8/§11 via oshinagaki.)

## 0.4 ask_bank matching (decision)

- **v1 = capability/tag match** (cheap, deterministic): match task tags/required
  capabilities against recipe `toolset`/`capabilities`. No per-delegate LLM cost.
- Semantic (embedding) match deferred to a later phase if v1 recall is poor.
- **Order invariant**: `delegate_goal` MUST call `ask_bank` before `mint_specialist`
  (reuse-first). mint only on empty/insufficient bank match. (W-2)

## Carry-over to design doc (oshinagaki)
- §8: ledger is a derived view over runs; single composite promotion gate.
- §8/§11: visibility maps to `ticket.metadata.visibility`; recipe placement path.
- §8: staging toolset allowlist (B-1).
