import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PORT || 8789);

const slots = Object.freeze(["voice", "text"]);

const readJson = (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const writeJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
};

const envName = (slot, suffix) => `IROHARNESS_${slot.toUpperCase()}_${suffix}`;

const envValue = (env, slot, suffix, fallback = null) =>
  env[envName(slot, suffix)] || env[`IROHARNESS_${suffix}`] || fallback;

const trimSlash = (value) => String(value || "").replace(/\/+$/, "");

const slotFromPath = (pathname) => slots.find((slot) => pathname === `/${slot}`) || null;

export const createBrainPrompt = ({ slot, payload }) => {
  const character = payload.character || {};
  const actor = payload.actor || {};
  const audience = payload.audience || {};
  const input = payload.input || {};
  const route = payload.route || {};
  const projectOs = payload.projectOs || {};
  const ticketCount = Array.isArray(projectOs.tickets) ? projectOs.tickets.length : 0;
  const permissions = Array.isArray(audience.permissions) ? audience.permissions.join(", ") : "";

  const system = [
    `You are ${character.name || character.id || "the IroHarness character"}.`,
    "Stay in the same character identity supplied by the macro harness.",
    slot === "voice"
      ? "Reply briefly for low-latency spoken output."
      : "Reply naturally for text chat, including developer-level or strategic discussion.",
    character.soul ? `SOUL:\n${character.soul}` : null,
    character.identity ? `IDENTITY:\n${character.identity}` : null,
    character.memory ? `MEMORY:\n${character.memory}` : null,
    character.voiceStyle ? `VOICE:\n${character.voiceStyle}` : null
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `slot: ${slot}`,
    `route: ${route.kind || "text"}`,
    `actor: ${actor.displayName || actor.user?.displayName || "guest"}`,
    `relationship: ${audience.relationship || "public"}`,
    `responseDepth: ${audience.responseDepth || "public"}`,
    `permissions: ${permissions || "none"}`,
    `pjosTicketCount: ${ticketCount}`,
    "",
    input.text || ""
  ].join("\n");

  return Object.freeze({ system, user });
};

export const createProviderConfig = ({ slot, env = process.env }) => {
  const provider = envValue(env, slot, "BRAIN_PROVIDER", "openai-compatible");
  const model = envValue(
    env,
    slot,
    "BRAIN_MODEL",
    provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-oss:20b"
  );
  const maxTokens = Number(envValue(env, slot, "BRAIN_MAX_TOKENS", slot === "voice" ? 160 : 700));

  return Object.freeze({
    provider,
    model,
    maxTokens,
    openai: Object.freeze({
      apiKey: env.OPENAI_API_KEY || "",
      baseUrl: trimSlash(env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    }),
    anthropic: Object.freeze({
      apiKey: env.ANTHROPIC_API_KEY || "",
      baseUrl: trimSlash(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1"),
      version: env.ANTHROPIC_VERSION || "2023-06-01"
    }),
    compatible: Object.freeze({
      apiKey: env.LOCAL_OPENAI_API_KEY || env.OPENAI_COMPATIBLE_API_KEY || "local",
      baseUrl: trimSlash(
        env.LOCAL_OPENAI_BASE_URL || env.OPENAI_COMPATIBLE_BASE_URL || "http://127.0.0.1:11434/v1"
      )
    })
  });
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `provider request failed: ${response.status}`);
  }
  return payload;
};

const extractOpenAIText = (payload) => {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text || "")
    .join("")
    .trim();
};

const extractAnthropicText = (payload) =>
  (Array.isArray(payload.content) ? payload.content : [])
    .map((content) => content.text || "")
    .join("")
    .trim();

const extractChatText = (payload) => payload.choices?.[0]?.message?.content || "";

const requireKey = (value, label) => {
  if (!value) {
    throw new Error(`${label} is required for this provider`);
  }
  return value;
};

export const callProvider = async ({ slot, payload, config, fetchImpl = fetch }) => {
  const prompt = createBrainPrompt({ slot, payload });

  if (config.provider === "openai") {
    const response = await fetchImpl(`${config.openai.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requireKey(config.openai.apiKey, "OPENAI_API_KEY")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        instructions: prompt.system,
        input: prompt.user,
        max_output_tokens: config.maxTokens
      })
    });
    const providerPayload = await parseJsonResponse(response);
    return {
      text: extractOpenAIText(providerPayload),
      emotion: "attentive",
      provider: "openai",
      model: config.model
    };
  }

  if (config.provider === "anthropic") {
    const response = await fetchImpl(`${config.anthropic.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": requireKey(config.anthropic.apiKey, "ANTHROPIC_API_KEY"),
        "anthropic-version": config.anthropic.version,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }]
      })
    });
    const providerPayload = await parseJsonResponse(response);
    return {
      text: extractAnthropicText(providerPayload),
      emotion: "attentive",
      provider: "anthropic",
      model: config.model
    };
  }

  if (config.provider === "openai-compatible") {
    const response = await fetchImpl(`${config.compatible.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.compatible.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        max_tokens: config.maxTokens
      })
    });
    const providerPayload = await parseJsonResponse(response);
    return {
      text: extractChatText(providerPayload),
      emotion: "attentive",
      provider: "openai-compatible",
      model: config.model
    };
  }

  throw new Error(`Unsupported brain provider: ${config.provider}`);
};

export const createProviderBrainGatewayHandler = ({
  env = process.env,
  fetchImpl = fetch
} = {}) => async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "iroharness-provider-brain-gateway",
      slots: slots.map((slot) => ({
        slot,
        provider: createProviderConfig({ slot, env }).provider,
        model: createProviderConfig({ slot, env }).model
      }))
    });
    return;
  }

  const slot = slotFromPath(url.pathname);
  if (request.method !== "POST" || !slot) {
    writeJson(response, 404, {
      error: "not_found",
      routes: ["POST /voice", "POST /text", "GET /health"]
    });
    return;
  }

  try {
    const payload = await readJson(request);
    const config = createProviderConfig({ slot, env });
    writeJson(response, 200, await callProvider({ slot, payload, config, fetchImpl }));
  } catch (error) {
    writeJson(response, 502, {
      error: "provider_brain_request_failed",
      message: error.message
    });
  }
};

const runningDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (runningDirectly) {
  const server = createServer(createProviderBrainGatewayHandler());

  server.listen(port, "127.0.0.1", () => {
    console.log(`IroHarness provider brain gateway: http://127.0.0.1:${port}`);
    console.log(`voice=http://127.0.0.1:${port}/voice`);
    console.log(`text=http://127.0.0.1:${port}/text`);
  });

  process.once("SIGINT", () => {
    server.close(() => process.exit(0));
  });
}
