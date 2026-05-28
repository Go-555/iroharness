# Codex Adapter

IroHarness can delegate coding work to Codex through `codex app-server`.

For a Slack-facing runtime that uses the host machine's Codex OAuth session,
see [slack-codex.md](./slack-codex.md).
For using Codex OAuth as the main text/deep brain instead of only as a coding
worker, see [brains.md](./brains.md#codex-oauth-brain).

Codex OAuth belongs to the local `codex app-server` process on the host where
`codex login` was completed. It should not be treated as a public gateway
credential. If a gateway receives a request that requires local repository
access, file edits, approvals, or review, route it to a Codex micro harness with
a scoped workspace and explicit IroHarness permissions.

The macro harness still owns:

- character identity
- audience/user permissions
- Project OS tickets and runs
- device/body state

Codex is treated as a micro harness that executes development work.

## Example

```bash
IROHARNESS_RUN_CODEX=1 CODEX_WORKSPACE=/path/to/project CODEX_MODEL=gpt-5.4 npm run example:codex -- "CodexでREADMEをレビューして"
```

## Programmatic Use

```js
import { createCodexAppServerMicroHarness } from "iroharness/adapters";

const codex = createCodexAppServerMicroHarness({
  cwd: "/path/to/project",
  model: "gpt-5.4",
  approvalPolicy: "on-request",
  sandboxPolicy: {
    type: "workspaceWrite",
    writableRoots: ["/path/to/project"],
    networkAccess: false
  }
});
```

Then register it as a micro harness:

```js
const iroha = createIroHarness({
  character,
  projectOs,
  userRegistry,
  brains,
  microHarnesses: [codex]
});
```

## Event Capture

The adapter collects Codex app-server events during a turn and returns:

```json
{
  "status": "completed",
  "summary": "assistant message text",
  "artifacts": [
    {
      "kind": "codex-events",
      "uri": "memory://codex/ticket_123",
      "title": "Codex app-server events"
    }
  ]
}
```

This lets PJOS preserve that a coding task was delegated to Codex while keeping
the character macro harness as the user-facing personality.
