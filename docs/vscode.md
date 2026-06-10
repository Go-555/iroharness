# VS Code Companion

IroHarness can appear inside VS Code as another body/interface for the same
macro harness character. The VS Code panel does not own personality. It sends
turns as the `vscode` platform to the local IroHarness dev server, where user
identity, permissions, PJOS, and micro-harness delegation are decided.

```text
VS Code Webview
  -> POST /turn source=vscode
  -> IroHarness macro harness
  -> voice/text brain or micro harness
  -> SSE /events back into the panel
```

## Run

Start the dev server:

```bash
npm run demo:browser
```

Then open the example extension in VS Code:

```bash
code examples/vscode-companion
```

Run `IroHarness: Open Companion` from the command palette.

## Identity

The extension sends:

```json
{
  "source": "vscode",
  "actor": {
    "platform": "vscode",
    "platformUserId": "vscode-local",
    "displayName": "VS Code Developer"
  }
}
```

Link that `vscode` identity to the same canonical user as Slack, Discord,
YouTube, browser, M5Stack, or Even G2 identities. That keeps permissions and
relationship state stable while the interface changes.
