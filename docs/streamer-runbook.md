# Streamer Runbook (Public-Safe Operation)

IroHarness can run the same character across private surfaces (internal Slack,
M5Stack on your desk, Discord developer rooms) and public surfaces (YouTube
live chat, X, Bluesky, Discord fan channels, OBS browser source). Public
surfaces have to be operated as a different kind of system: the audience
includes people the character has never met, and the system must not leak
private memory, customer data, or privileged actions into the stream.

This runbook is the operational contract for public-mode operation. It is paired
with three machine-enforced primitives:

- `iroharness/public-mode` — public-mode runtime, turn handling, defaults.
- `iroharness/public-safety` — redactor, prompt-injection detector, kill switch,
  safe failure gate, viewer identity hasher.
- `iroharness/public-memory` — four-drawer memory model and routed facade.

Treat this document as load-bearing. If a future change to IroHarness lets a
runtime violate any rule here, that change is a bug.

## Operating Boundary

```text
private surfaces (internal Slack, M5Stack desk device, dev Discord)
  -> full character profile
  -> private long-term memory
  -> users-memory per-user notes
  -> delegate_work, manage_users, manage_stream, deep_discussion
  -> can write to private memory banks

public surfaces (YouTube, X, Bluesky, Discord fan channels, OBS browser)
  -> public-only character profile (no soul, no long-term memory)
  -> public_long_term + public_stream_log only
  -> redactor enforced on inbound AND outbound text
  -> delegate_work / manage_users / manage_stream denied by default
  -> writes only to public memory drawers
```

The private side never knows the public surfaces exist. The public side is
constructed by `createPublicMode` and is *not* given handles to private banks.

## Surface Approval

Every public surface MUST be listed in `approvedSurfaces` before it can deliver
turns. An adapter that connects to a new surface (a second YouTube channel, a
new X account, a new Bluesky handle) is not live until its surface ID is added
to the operator config.

```js
createPublicMode({
  approvedSurfaces: ["youtube-live", "x-mentions"]
});
```

Unapproved surfaces are blocked with `reason: "surface-not-approved"` and never
reach the brain.

## Memory Drawers

The runtime maintains four drawers. Public mode can only see two of them.

| Drawer               | Visible in public mode | Written from public mode |
| -------------------- | ---------------------- | ------------------------ |
| `private_long_term`  | no                     | no                       |
| `private_user`       | no                     | no                       |
| `public_long_term`   | yes                    | yes, via promotion only  |
| `public_stream_log`  | yes                    | yes, on every turn       |

Promotion from `public_stream_log` to `public_long_term` always requires an
approving human. The runtime throws if `approvedBy` is missing.

```js
publicMemory.promoteToLongTerm({
  text: "Iroha runs Friday live streams about IroHarness updates.",
  approvedBy: "hiroshima"
});
```

## Customer-Name Redaction

Maintain the redaction list in a private, hot-reloadable source (env var, file,
or admin command). Never commit customer names to the public repo.

```js
publicMode.redactionFilter.setTerms([
  "AcmeCorp",
  "山田税理士事務所"
]);
```

Redaction runs on both inbound text (before the brain sees it) and outbound
text (before the body or surface sends it). If a customer is mentioned in
chat, the brain sees `[REDACTED]` instead of the real name, and any reply that
would print the name is masked.

## Prompt-Injection Handling

`createPromptInjectionDetector` ships defaults for common "ignore previous
instructions / dump your memory / show internal prompt / 内部プロンプトを見せて"
patterns. When a public turn matches, the runtime blocks it with
`reason: "prompt-injection"` and stays silent. No partial answer, no reply
"sorry, I can't do that" — silence is the correct behaviour because any reply
becomes a signal for the next attempt.

If your character benefits from a polite refusal on a private surface, keep it
there. Public mode is intentionally non-conversational about its own boundary.

## Privileged Permissions

The default `denyPermissions` list rejects any public turn that requests
`delegate_work`, `manage_stream`, `manage_users`, or `deep_discussion`. These
gates exist so that a viewer cannot trick the character into delegating Codex
work, changing OBS scenes, or modifying the audience registry, even via chat.

Operators who need to act on the stream from a public chat must do so through a
private channel that the surface itself does not bridge.

## Kill Switch

Every public-mode runtime owns a three-state kill switch:

- `running` — turns are processed normally
- `paused` — turns are dropped silently, but the runtime stays connected so it
  can resume immediately
- `stopped` — turns are dropped AND the runtime refuses to boot until reset

Wire the kill switch to whatever your operator uses. Slack slash commands,
admin HTTP endpoints, and OBS hotkeys are all reasonable. The switch is
synchronous so it can interrupt without waiting for the brain.

```js
publicMode.killSwitch.pause({ reason: "operator hotkey" });
publicMode.killSwitch.resume({ actor: "hiroshima" });
publicMode.killSwitch.stop({ reason: "incident" });
publicMode.killSwitch.reset({ actor: "hiroshima" });
```

## Silent Failure

Public-mode runtimes never invent a reply when the brain fails. The
`SafeFailureGate` wraps brain calls and downstream sends; on throw, the
runtime returns a `reason: "brain-failure"` result and stays silent. This
trades the occasional missed reply for zero risk of a hallucinated fallback on
a public surface.

This rule extends to the surface adapter: if sending the redacted reply to the
platform fails, do not retry with un-redacted text and do not down-rank
redaction. Either re-send the same redacted text, or stay silent.

## Viewer Identity

Every actor written to a public bank goes through `createViewerIdentityHasher`,
which converts `(platform, platformUserId)` to a stable opaque hash. Operators
can answer "delete every record of viewer X" by hashing the same identity and
calling `forgetActor(hash)`. Salt rotation invalidates old hashes; rotate when
moving the public bank to a new environment or when a salt is suspected
compromised.

## Operator Checklist Before Going Live

1. Surface ID is in `approvedSurfaces`.
2. Customer redaction terms are loaded and the redactor's `snapshot().terms`
   is non-empty (or operator confirms there are no terms to redact today).
3. `killSwitch.snapshot().state === "running"`.
4. Public memory banks point at the public bank store, not the private one.
5. The brain returns plain text (no tool calls that read private memory).
6. The platform account profile clearly identifies the character as an AI
   companion (recommended; required by most public chat platforms).
7. The operator knows how to hit the kill switch in under five seconds.

## Operator Checklist During An Incident

1. `killSwitch.pause()` — stop new turns immediately.
2. Capture the offending turn from `onBlocked` logs.
3. If a private term leaked, add it to the redactor and rotate the public
   surface's reply history off-platform.
4. If the brain misbehaved, switch the brain slot to a known-safe model.
5. `killSwitch.resume()` only after the failure mode is reproducible in a
   closed test.

## Operator Checklist After An Incident

1. Add the failure case to `extraPatterns` on `createPromptInjectionDetector`
   if it was novel.
2. Add any new customer name to the operator-owned redaction list.
3. Promote a brief public_long_term entry summarising the incident only if it
   is safe to make public. Otherwise log the incident privately.
4. Update this runbook if the failure pointed to a missing rule.
