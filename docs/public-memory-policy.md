# Public Memory Policy

IroHarness stores character memory in four drawers. This document defines what
goes in each drawer, who can write to it, and which drawers are visible from
public mode.

## Drawers

```text
private_long_term   character soul, identity, durable private memory
private_user        users-memory/*.md per-user notes
public_long_term    durable, human-approved facts safe for any viewer
public_stream_log   raw episodic log of what happened on public surfaces
```

The private drawers live behind the regular harness boundary and are loaded
through `createFileCharacterProfile`, `createInMemoryProjectOs`, and the
audience registry. They are intentionally absent from the public-mode runtime.

The public drawers are implemented in `iroharness/public-memory` as bounded
in-memory banks today. Hosts that need durability can supply their own
`PublicMemoryBank` implementations to `createPublicMemoryFacade` without
changing the rest of the public-mode contract.

## What Goes Where

### `private_long_term`

- character soul, voice, identity
- operational state and configuration
- learnings from private sessions
- anything that names a real customer, deal, or non-public project

### `private_user`

- per-user preferences and style
- private nicknames and protocol with named individuals
- consented-to context that the user has not asked to be public

### `public_long_term`

- the character's public bio, stream schedule, public personality notes
- recurring stream segments, opening lines, public catch phrases
- public-friendly summaries that a human operator has reviewed

Writes go through `publicMemory.promoteToLongTerm({ approvedBy })` and require
a non-empty `approvedBy`. This makes promotion an explicit, attributable act,
not an emergent decision by the brain.

### `public_stream_log`

- every inbound turn from a public surface
- every outbound reply the runtime sent on a public surface
- block events from the public-mode runtime (kill switch, injection, denial)

Entries are bounded (default 500) so log volume cannot exhaust the host. Hosts
that need longer retention should replicate writes into their own storage with
the same hashed-actor scheme.

## Visibility From Public Mode

`createPublicMemoryFacade.recallForBrain` is the only path the public-mode
runtime uses to read memory before invoking the brain. It returns:

```json
{
  "publicLongTerm":  [...up to limit entries],
  "publicStreamLog": [...up to limit entries scoped to the same actor/session],
  "privateLongTerm": [],
  "privateUser":     [],
  "drawers": {
    "private_long_term": "closed",
    "private_user":      "closed",
    "public_long_term":  "open",
    "public_stream_log": "open"
  }
}
```

The private arrays are always empty and always closed. There is no method on
the facade that opens them, and the runtime never constructs a facade that
holds the private banks.

## Actor Identity

Actors are written to public banks by their hashed identity, never their raw
platform user ID. `createViewerIdentityHasher` produces stable per-salt hashes
so that operators can support deletion requests without retaining raw IDs.

```text
actorHash = hash(salt, platform, platformUserId)
```

Rotating the salt invalidates all previous hashes. Plan rotation around
deletion windows so that "forget everything before T" can be implemented by
combining a salt rotation with a TTL on existing entries.

## Operator Workflows

### Promote a stream highlight to long-term

```js
publicMemory.promoteToLongTerm({
  text: "Iroha's Friday IroHarness office hours run from 21:00 JST.",
  tags: ["schedule"],
  approvedBy: "hiroshima"
});
```

### Handle a viewer deletion request

```js
const hash = viewerIdentityHasher.hash("youtube", "UCabc123");
const removed = publicMemory.forgetActor(hash);
console.log(`removed ${removed} entries for viewer`);
```

### Audit what reached the public drawers today

```js
const log = publicMemory.recallForBrain({ limit: 200 });
for (const entry of log.publicStreamLog) {
  console.log(entry.createdAt, entry.tags.join(","), entry.text);
}
```

## What Public Mode Must Never Do

- read `private_long_term` or `private_user`
- pass character soul/memory text into the brain request
- write to private banks under any code path
- store raw platform user IDs alongside public bank entries
- accept a `promoteToLongTerm` call without `approvedBy`

If a future change requires any of those, treat it as a redesign of the
boundary and update both `iroharness/public-mode` and this document together.
