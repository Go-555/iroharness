# Character Profile Files

IroHarness keeps character identity in the macro harness, not inside a model,
micro harness, or body adapter. `createFileCharacterProfile` loads that identity
from markdown files.

```js
import { createFileCharacterProfile } from "iroharness";

const character = createFileCharacterProfile({
  dir: ".",
  id: "iroha",
  name: "Iroha"
});
```

Files:

- `AGENTS.md`: operating instructions for coding agents and micro harnesses
- `SOUL.md`: personality, tone, boundaries, and stable behavior
- `IDENTITY.md`: who the character is
- `MEMORY.md`: durable facts and relationship context
- `VOICE.md`: optional voice style

The returned profile can be passed directly to `createIroHarness`.

`AGENTS.md` is not loaded into the character profile automatically. It is for
tools that enter the companion repository directly, such as Codex, Claude Code,
OpenClaw, Hermes, or local automation. It should repeat the important
invariants: the macro harness owns identity, permissions gate privileged work,
and Project OS is the durable work state.
