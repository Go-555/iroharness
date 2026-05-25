# Design Principles

IroHarness is a character macro harness. The goal is not to replace every agent
runtime. The goal is to keep one character coherent while many engines,
interfaces, bodies, and micro harnesses change underneath it.

## 1. The Macro Harness Owns Identity

The character is not the model, the prompt, the body, or the worker runtime.

The character identity is the combination of:

- `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, and optional `VOICE.md`
- macro harness routing and permission policy
- Project OS state
- realtime state and expression state
- the history of interactions with users

Models and tools can be swapped. The character should remain recognizable.

## 2. Interfaces Are Bodies, Not Personalities

Slack, Discord, YouTube, VS Code, browser, M5Stack, Even G2, Live2D,
MotionPNGTuber, and VRM are different bodies or entry points for the same
character.

They should not each define a separate personality unless the application
explicitly wants separate characters.

## 3. Micro Harnesses Are Delegated Workers

Codex, Claude Code, OpenClaw, Hermes, and future harnesses are treated as
specialized workers or peers.

IroHarness sends them task context:

- character profile
- actor identity and permissions
- Project OS snapshot
- ticket/run intent

The micro harness returns work results. It does not automatically become the
same character.

## 4. Project OS Is The Durable State Layer

Conversation logs are not enough. IroHarness keeps goals, tickets, runs, and
artifacts in Project OS so work can continue across sessions and interfaces.

When a task becomes work, it should create or update Project OS state.

## 5. Permissions Are Separate From Affection

A fan, member, moderator, developer, and owner may all talk to the same
character. Their access differs, but the character identity should not splinter.

Privileged actions such as stream control and micro-harness delegation must pass
permission checks.

## 6. Realtime Is A Replaceable Fast Path

The JavaScript core defines stable contracts. Rust, Go, WASM, native modules, or
JSONL processes can replace the low-latency event/audio/device path later.

The realtime core may own fast loops. It should not own character identity.

## 7. Borrow Runtimes, Own The Boundary

IroHarness should integrate with strong external systems instead of copying all
of them:

- OpenClaw/Hermes-style gateways and memory systems
- Codex/Claude Code-style development agents
- AIAvatarKit-style speech/avatar stacks
- OBS/Discord/YouTube/Slack platform APIs

The unique work is the boundary: identity, state, permission, routing, and body
projection.

## 8. Make Adapters Thin And Testable

Adapters should normalize external systems into IroHarness contracts. They
should avoid owning business logic or character policy.

Every new adapter should have:

- a small contract test
- a documented input/output shape
- a fixture or example when possible

## 9. Local First, Network Later

The core should work locally without hosted services. PostgreSQL, Supabase,
platform APIs, and native realtime engines are optional upgrades.

This keeps the project useful for experiments, devices, and offline development.

## 10. Fun Is A Product Requirement

The system exists because people want to work with a character, not just an API.
Body expression, voice, timing, and continuity matter. They are not decorative
afterthoughts.
