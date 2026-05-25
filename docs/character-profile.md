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

- `SOUL.md`: personality, tone, boundaries, and stable behavior
- `IDENTITY.md`: who the character is
- `MEMORY.md`: durable facts and relationship context
- `VOICE.md`: optional voice style

The returned profile can be passed directly to `createIroHarness`.
