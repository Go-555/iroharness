const vscode = require("vscode");

const trimServerUrl = (value) => String(value || "http://127.0.0.1:4178").replace(/\/+$/, "");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const createWebviewHtml = ({ serverUrl, actor }) => {
  const config = safeJson({
    serverUrl: trimServerUrl(serverUrl),
    actor
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>IroHarness</title>
    <style>
      :root { color-scheme: dark; font-family: var(--vscode-font-family); }
      body { margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
      main { display: grid; gap: 10px; }
      #status { color: var(--vscode-descriptionForeground); font-size: 12px; }
      #events { display: grid; gap: 8px; max-height: 55vh; overflow: auto; }
      .event { border: 1px solid var(--vscode-panel-border); padding: 8px; background: var(--vscode-editor-background); }
      .event strong { display: block; margin-bottom: 4px; color: var(--vscode-textLink-foreground); }
      form { display: grid; gap: 8px; }
      textarea { width: 100%; min-height: 86px; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
      button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 10px; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <div id="status">Connecting to IroHarness...</div>
      <div id="events"></div>
      <form id="turn-form">
        <textarea id="text" placeholder="IroHarness と話す"></textarea>
        <button type="submit">Send</button>
      </form>
    </main>
    <script>
      const config = ${config};
      const status = document.querySelector("#status");
      const events = document.querySelector("#events");
      const form = document.querySelector("#turn-form");
      const text = document.querySelector("#text");

      const appendEvent = (label, value) => {
        const row = document.createElement("div");
        row.className = "event";
        const strong = document.createElement("strong");
        strong.textContent = label;
        const body = document.createElement("div");
        body.textContent = typeof value === "string" ? value : JSON.stringify(value);
        row.append(strong, body);
        events.prepend(row);
      };

      const loadState = async () => {
        const response = await fetch(config.serverUrl + "/state");
        const state = await response.json();
        status.textContent = state.character.name + " / " + state.mode + " / " + state.emotion;
      };

      const connectEvents = () => {
        const source = new EventSource(config.serverUrl + "/events");
        source.addEventListener("speech", (event) => appendEvent("speech", JSON.parse(event.data)));
        source.addEventListener("task", (event) => appendEvent("task", JSON.parse(event.data)));
        source.addEventListener("state", (event) => {
          const payload = JSON.parse(event.data);
          status.textContent = payload.state.mode + " / " + payload.state.emotion;
        });
        source.onerror = () => {
          status.textContent = "Reconnecting to " + config.serverUrl;
        };
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const value = text.value.trim();
        if (!value) return;
        await fetch(config.serverUrl + "/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "vscode",
            modality: "text",
            text: value,
            actor: config.actor
          })
        });
        text.value = "";
      });

      loadState().then(connectEvents).catch((error) => {
        status.textContent = String(error.message || error);
      });
    </script>
  </body>
</html>`;
};

const activate = (context) => {
  const disposable = vscode.commands.registerCommand("iroharness.openCompanion", () => {
    const config = vscode.workspace.getConfiguration("iroharness");
    const panel = vscode.window.createWebviewPanel(
      "iroharnessCompanion",
      "IroHarness",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    );
    panel.webview.html = createWebviewHtml({
      serverUrl: config.get("serverUrl"),
      actor: {
        platform: "vscode",
        platformUserId: config.get("platformUserId") || "vscode-local",
        displayName: vscode.env.machineId || "VS Code Developer"
      }
    });
  });
  context.subscriptions.push(disposable);
};

const deactivate = () => {};

module.exports = {
  activate,
  deactivate,
  createWebviewHtml,
  trimServerUrl
};
