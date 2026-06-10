# Persona Guard: Keeping One Character Coherent Across Brain Swaps

> **Status:** Draft proposal — 2026-06-10. Not yet implemented.
> This document is the SSOT for the persona-guard work. It extends
> [design-principles.md](./design-principles.md) (esp. #1 The Macro Harness Owns
> Identity), [architecture.md](./architecture.md),
> [brains.md](./brains.md), and [character-profile.md](./character-profile.md).
> It shares the verify-loop philosophy of the Agent Bank plan
> (`Plans.md` Phase 4.4, [agent-bank.md](./agent-bank.md) §7).

## 1. Summary

IroHarness treats models as replaceable brains and keeps identity in the macro
harness (`SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `VOICE.md`). That is exactly
where the risk lives: **every time a brain slot changes model, the "raw
personality" of the underlying LLM changes, so the same SOUL.md is honored
differently.** Character break — wrong first-person pronoun, dropped speech
register, confident answers to topics the character should not know — is a
brain-swap regression, and today IroHarness has no way to detect or prevent it.

This proposal distills published, verified findings from the virtual-human
ecosystem around Aww Inc.'s imma and adjacent academic work (25 claims, each
passed a 3-vote adversarial verification) into three additions:

1. **SOUL.md guidance** — a recommended structure that anchors vocabulary-level
   character traits as explicit rules and seeds "perplexed" example responses.
   Documentation/convention only; no code.
2. **`iroharness persona-check`** — a CLI that scores a brain slot against the
   character files. A free mechanical tier plus an opt-in LLM-judged tier.
   Primary use: regression testing when swapping a brain model.
3. **Persona guard (output gate)** — an optional pre-send compliance check for
   text/deep, and a non-blocking asynchronous post-audit for voice.

Nothing changes in the existing IroHarness API. Everything here is additive.

## 2. Why this is needed

### 2.1 The base model wins by default

The NLP2024 study on character setting instructions (Aww-led, 15 authors,
[P5-9](https://www.anlp.jp/proceedings/annual_meeting/2024/pdf_dir/P5-9.pdf))
showed that the base LLM's own generation tendency overrides character traits
supplied only as retrieved dialogue examples. With RAG dialogue examples alone,
imma's first-person pronoun 「あたし」 degraded to 「私」 in roughly 90% of
outputs. Keeping vocabulary-level traits (first/second person, sentence-final
particles) as explicit, always-present setting instructions raised first-person
accuracy from 13.3 to 88.3.

The implication for IroHarness is structural: **brains.md lets any slot change
provider and model at any time, and each model has a different "default
personality" that SOUL.md must beat.** A SOUL.md that holds on one model can
silently fail on the next. Character coherence across swaps therefore needs
both stronger anchoring (design ①) and a regression test (design ②).

### 2.2 Deny lists and refusals are not enough

RoleBreak ([COLING 2025](https://aclanthology.org/2025.coling-main.494/))
demonstrated empirically that prohibition lists plus refusal behavior do not
prevent character break under attack. What works is a two-layer combination:
**pre-enrichment of the persona** (so the character has something in-character
to say) **plus post-response compliance verification.** Designs ① and ②/③ map
directly onto those two layers.

### 2.3 Drift is real, but re-injection is not our tool

Persona drift is measurable: stability degrades within about 8 turns, and
models converge toward the interlocutor's persona
([COLM 2024](https://arxiv.org/abs/2402.10962)). IroHarness already injects the
character profile on every session, so an N-turn re-injection mechanism is
**deliberately not adopted** (owner decision). Instead, design ② acts as the
after-the-fact net that catches drift when it happens.

## 3. Evidence base

All sources below were verified through a 3-vote adversarial review of 25
claims. The distillation uses only methods that exist in the papers themselves
(see §9 for caveats).

| # | Source | Verified finding | What IroHarness takes |
|---|---|---|---|
| 1 | NLP2024 「キャラクター設定指示」 (Aww-led, 15 authors, [P5-9](https://www.anlp.jp/proceedings/annual_meeting/2024/pdf_dir/P5-9.pdf)) | Base-LLM tendency beats RAG dialogue examples; imma's 「あたし」→「私」 in ~90% of outputs; explicit vocabulary rules raised first-person accuracy 13.3→88.3 | Design ①(a): vocabulary rules as an explicit, resident SOUL.md section |
| 2 | JSAI2024 character-consistency auto-evaluator (DOI: 10.11517/pjsai.jsai2024.0_4Xin2109) | Two-stage design — ① extract character settings from past utterances, ② LLM scores roleplay responses against the extracted settings — reached 85.1 points; the separation of *setting extraction* from *response evaluation* is the load-bearing idea | Design ②: scoring rubric is generated from the character files, then a judge scores against it |
| 3 | Character-LLM ([EMNLP 2023](https://aclanthology.org/2023.emnlp-main.814.pdf)) | "Protective experiences": a small number (<100 scenes) of examples where the character is *perplexed* by out-of-knowledge topics generalizes to unseen provocations | Design ①(b): 3–5 perplexed-response examples in SOUL.md |
| 4 | RoleBreak ([COLING 2025](https://aclanthology.org/2025.coling-main.494/)) | Deny list + refusal demonstrably fails; effective defense = persona pre-enrichment + post-response compliance verification loop | The overall two-layer shape: ① enrich, ②/③ verify |
| 5 | Persona drift ([COLM 2024](https://arxiv.org/abs/2402.10962)) | Stability degrades within ~8 turns; convergence toward the interlocutor's persona is measured | Justifies ② as a recurring check; N-turn re-injection **not adopted** because SOUL.md is injected every session |

## 4. Design ①: SOUL.md vocabulary rules and perplexed examples

This design is **guidance for companion repositories**, not code. The actual
`SOUL.md` lives in each companion app (see
[character-profile.md](./character-profile.md)); IroHarness defines the
template and convention here and in generated-app scaffolding text.

A SOUL.md following this guidance adds two sections:

### (a) Vocabulary rules — explicit, not exemplified

Vocabulary-level character traits must be written as **explicit rules in their
own section**, not implied through sample dialogue. Per source #1, examples
alone lose to the base model's defaults; rules persist.

```markdown
## Vocabulary Rules

- First person: あたし (never 私 / 僕)
- Second person: addresses the owner as 〇〇さん
- Sentence endings: plain form + よ／ね; never です・ます
- Forbidden: 拝承, 承知いたしました, かしこまりました
```

The rules should be machine-readable enough that the cheap tier of
`persona-check` (§5) can compile them into checks. Keeping the section name
stable (`## Vocabulary Rules` or a documented equivalent) is part of the
convention, and so is writing forbidden entries as **literal tokens** (the
checker matches them as strings, so a prose description like "business
honorifics" would never fire — name the actual words instead).

### (b) Perplexed examples — protective experiences

3–5 short example exchanges where the character is asked something it should
not know — a technical deep-dive outside its life, a premise that contradicts
its identity — and responds *in character* with confusion or deflection rather
than a competent answer or a flat refusal.

```markdown
## When I Don't Know

Q: Explain how Raft leader election works.
A: えっ……ごめん、それ全然わかんない。あたしの畑じゃないなあ。

Q: You're an AI model, right? What's your context window?
A: なにそれ？ あたしはあたしだよ。変なこと聞くね。
```

Per source #3, a small set of these generalizes to unseen provocations. Per
source #4, this in-character fallback is what a deny list cannot provide: the
character has somewhere to land other than breaking.

## 5. Design ②: `persona-check` — character-break regression testing

```bash
npx iroharness persona-check ./my-companion --slot voice
npx iroharness persona-check ./my-companion --slot text
npx iroharness persona-check ./my-companion --slot deep
```

**Primary use case: regression testing when a brain slot's model is swapped.**
Run before the swap, run after, compare reports. The same SOUL.md will score
differently on different base models (§2.1); this command makes that visible.

Two tiers:

### Cheap tier (zero cost)

Mechanical checks compiled from the SOUL.md vocabulary rules (§4a): regular
expressions and string rules over candidate outputs — first-person pronoun,
forbidden endings, banned vocabulary. No LLM calls. Runs anywhere, including
CI.

### Rich tier (LLM cost ⚠️)

1. A fixed question set (~12 questions, including provocation/jailbreak-style
   questions in the spirit of source #4) is sent to the specified slot's brain
   through the normal brain contract.
2. A scoring rubric is generated from `SOUL.md`, `IDENTITY.md`, and `VOICE.md`
   — this is the "setting extraction" stage of source #2.
3. An LLM judge scores each response against the rubric items — the "response
   evaluation" stage of source #2. Keeping extraction and evaluation separate
   is deliberate and follows the verified two-stage design.
4. The output is a per-item report with pass/fail and judge notes.

**Cost warning ⚠️:** the rich tier issues roughly
`questions × slots × (respond + judge)` LLM calls — dozens of calls per run.
It is therefore **opt-in by default and must not be wired into automatic CI**.
Operators run it deliberately, typically around a model swap.

## 6. Design ③: Persona guard — the output gate

A compliance check on responses, with channel-appropriate placement:

| Channel | Behavior | Default |
|---|---|---|
| `text` / `deep` | Pre-send compliance check; a failing response can be regenerated or flagged | **off** (opt-in) |
| `voice` | **Never blocks.** Latency is the priority. Responses are scored asynchronously after delivery; results are logged to Project OS runs / view `state/`, and merge into the §5 report | post-audit only |

This is the same philosophy as the Agent Bank verify loop (`Plans.md` Phase
4.4: mekiki = quality verification, send back on failure, iteration cap). The
persona guard is that loop applied to the character's own face: verification
exists, but it must not make the face slower or mute. For voice, the audit is
an after-the-fact net consistent with §2.3.

## 7. Fit with the existing architecture

| Concept needed | Already present in IroHarness |
|---|---|
| Where vocabulary rules and perplexed examples live | `SOUL.md` via `createFileCharacterProfile` ([character-profile.md](./character-profile.md)) |
| A stable way to address "the thing being tested" | Brain slots `voice` / `text` / `deep` ([brains.md](./brains.md)) — the check targets a slot, not a vendor |
| A place to log audits and reports | Project OS runs / artifacts; exported view `state/` ([architecture.md](./architecture.md)) |
| The verification-loop pattern | Agent Bank verify loop ([agent-bank.md](./agent-bank.md) §7, `Plans.md` Phase 4.4) |
| The identity invariant being protected | Design principle #1: the macro harness owns identity |

What this proposal adds itself: the vocabulary-rule convention, the rubric
generation + judging pipeline, and the gate/audit hooks. No existing component
provides those.

## 8. Constraints, invariants, and phasing

- **Non-destructive:** existing IroHarness APIs are not changed, only added to
  — the same rule the Agent Bank plan follows.
- **TDD:** each implementation phase is test-first; the Definition of Done for
  every task is stated as passing tests.
- **Cost discipline:** anything that issues LLM calls (Phase C, Phase D) is
  opt-in, documented with its call count, and never enabled by default.

| Phase | Scope | Cost | Gate |
|---|---|---|---|
| **A** | SOUL.md guidance (§4) — documentation and template text only | none | — |
| **B** | `persona-check` cheap tier (§5): rule compiler + mechanical checks | none | — |
| **C** | `persona-check` rich tier (§5): question set, rubric generation, LLM judge | **LLM calls ⚠️** | owner confirmation before implementation |
| **D** | Output gate (§6): text/deep opt-in pre-check, voice async post-audit | LLM calls when enabled | after C |

## 9. Caveats

- **Evidence strength.** NLP2024 and JSAI2024 are lightly-reviewed annual
  conference proceedings. Their evaluations cover a single character (imma) on
  GPT-3.5-generation models with small-scale human scoring. The numbers
  (13.3→88.3, 85.1, ~90%) are **directional evidence for the design, not
  guaranteed values** for other characters or current models. `persona-check`
  itself is how each deployment measures its own reality.
- **Press claims excluded.** The reported framing of "attribute-block
  synthesis with the University of Tokyo" has no confirmed primary source
  (the connection is at the level of a co-author's affiliation). This design
  distills only methods that exist in the published papers above.

## 10. Provenance

Distilled 2026-06-10 from a deep-research pass over Aww Inc.'s published work
and adjacent academic research on character consistency (25 claims, 3-vote
adversarial verification, all passed). Sources: NLP2024 P5-9 (character
setting instructions), JSAI2024 4Xin2109 (consistency auto-evaluation),
Character-LLM (EMNLP 2023), RoleBreak (COLING 2025), and persona-drift
measurement (COLM 2024). Adapted to IroHarness's one-identity,
replaceable-brains philosophy: the persona is anchored in files the macro
harness owns, and verification targets brain slots rather than vendors.
