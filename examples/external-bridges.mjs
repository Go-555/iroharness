import {
  createAIAvatarKitBridgeDevice,
  createHermesGatewayMicroHarness,
  createOpenClawMicroHarness
} from "../src/adapters/index.js";

const fakeFetch = async (endpoint, options) => {
  const payload = JSON.parse(options.body);
  console.log(JSON.stringify({ endpoint, payload }));
  return {
    ok: true,
    status: 200,
    async text() {
      if (endpoint.includes("openclaw")) {
        return JSON.stringify({ reply: "OpenClaw accepted the task" });
      }
      if (endpoint.includes("hermes")) {
        return JSON.stringify({ text: "Hermes accepted the task" });
      }
      return "{}";
    }
  };
};

const context = {
  character: {
    id: "iroha",
    name: "Iroha"
  },
  actor: {
    user: {
      id: "developer",
      displayName: "Developer"
    }
  },
  projectOs: {
    tickets: []
  }
};

const task = {
  id: "ticket_demo",
  title: "Bridge demo",
  purpose: "外部ハーネスとの接続を確認して"
};

const openclaw = createOpenClawMicroHarness({
  endpoint: "http://127.0.0.1:8787/openclaw/run",
  agentId: "iroha-openclaw",
  fetchImpl: fakeFetch
});

const hermes = createHermesGatewayMicroHarness({
  endpoint: "http://127.0.0.1:8765/hermes/message",
  conversationId: "iroha-hermes",
  fetchImpl: fakeFetch
});

const avatar = createAIAvatarKitBridgeDevice({
  eventEndpoint: "http://127.0.0.1:8000/iroharness/events",
  speechEndpoint: "http://127.0.0.1:8000/iroharness/speech",
  fetchImpl: fakeFetch
});

console.log(JSON.stringify(await openclaw.run(task, context)));
console.log(JSON.stringify(await hermes.run(task, context)));

avatar.emit({
  type: "speech",
  text: "外部ボディにも同じ人格の発話を流すよ。"
});

await new Promise((resolve) => setTimeout(resolve, 0));
