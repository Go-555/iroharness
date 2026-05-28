# Redaction Policy

The redactor is the last guard between IroHarness public mode and the audience.
It masks operator-supplied customer names, project codenames, and any other
term the host has decided must never appear on a public surface.

## Where The List Lives

The redaction list is operator-controlled and host-private. It is *not* stored
in the IroHarness repository, public memory banks, or any artifact that ships
to a public surface. Typical homes:

- a private file outside the repo (`~/.iroharness/redaction.local.json`)
- a private env var loaded at boot (`IROHARNESS_PUBLIC_REDACTION_TERMS`)
- a private admin API the operator calls from Slack

The list is loaded into the runtime via `createRedactionFilter({ terms })` and
can be hot-reloaded with `setTerms`, `addTerms`, or `removeTerms`.

## What The Redactor Does

- replaces every match with a single configurable placeholder (default
  `"[REDACTED]"`)
- applies on inbound text before it reaches the brain
- applies on outbound text before it leaves the runtime
- applies recursively to public memory entries via `redactObject`
- is case-insensitive by default; flip `caseSensitive: true` only if you have a
  reason

CJK terms (hiragana, katakana, kanji) are matched without word boundaries
because word boundaries are not meaningful for them. ASCII terms are matched on
word boundaries so that `"sun"` does not accidentally mask `"sunset"`.

## What The Redactor Does Not Do

- it does not understand spelling variants ("AcmeCorp" vs "Acme Corp")
- it does not understand transliteration ("山田" vs "Yamada")
- it does not redact numbers, emails, or addresses unless added explicitly
- it does not infer that a sentence is sensitive when no term matches

For variants, add them to the list. For semantic redaction, layer a domain
filter on top — but keep this redactor as the final mandatory pass.

## Operator Workflow

### Adding a new term during a stream

```js
publicMode.redactionFilter.addTerms(["AcmeCorp"]);
```

The next inbound turn and the next outbound reply will mask the term. Past
entries in the public memory banks are not retroactively redacted; see
"Cleaning up past entries" below.

### Removing a term

```js
publicMode.redactionFilter.removeTerms(["AcmeCorp"]);
```

Only do this after the term is no longer sensitive. Removed terms are not
re-applied to past entries either.

### Cleaning up past entries

The redactor only protects future text. If a term was missed, take three steps:

1. Add the term to the list so future text is masked.
2. Walk `publicMemory.publicLongTerm.list()` and remove offending entries.
3. Walk `publicMemory.publicStreamLog.list()` and remove or rewrite affected
   entries. The bank's `remove(predicate)` method makes this straightforward.

Off-platform copies (recorded streams, archived chat) are outside this
runtime's reach and must be handled by the platform's own moderation tools.

### Confirming the list is loaded

```js
const snapshot = publicMode.redactionFilter.snapshot();
console.log(snapshot.terms.length, "terms loaded");
```

The pre-flight checklist in `streamer-runbook.md` calls for this check before
going live.

## Failure Mode

If the redactor itself throws (it should not under normal use), the
`SafeFailureGate` upstream catches the exception and the runtime stays silent.
Public mode chooses silence over an unredacted reply.

## What Belongs On The Redaction List

- real customer or client names
- private project codenames not approved for public mention
- person names of people who have not consented to being mentioned on stream
- internal tool names that imply sensitive integrations
- terms that map back to identifiable customer data (specific contract sizes,
  industry-plus-region tuples that single out one customer)

What does NOT belong on the list:

- words you simply do not want the character to say (those belong in the
  character's voice profile or a higher-level moderation layer)
- generic banned words (those belong in a platform-specific moderation
  pipeline, not in a customer-protection redactor)

Keep the list scoped to identity protection. Mixing it with general moderation
makes both jobs harder.
