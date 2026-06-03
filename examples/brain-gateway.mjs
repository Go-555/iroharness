import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PORT || 8788);

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

const slotFromPath = (pathname) => {
  if (pathname === "/voice") {
    return "voice";
  }
  if (pathname === "/text") {
    return "text";
  }
  return null;
};

export const responseFor = ({ slot, payload }) => {
  const characterName = payload.character?.name || "Iroha";
  const actorName = payload.actor?.displayName || payload.actor?.user?.displayName || "guest";
  const responseDepth = payload.audience?.responseDepth || "public";
  const model = payload.model || `${slot}-demo`;
  const sourceText = payload.input?.text || "";
  const prefix =
    slot === "voice"
      ? "短く返すね"
      : "受け取ったよ";

  return {
    text: `${characterName}/${slot}/${model}: ${prefix}。${actorName}向けの${responseDepth}応答: ${sourceText}`,
    emotion: "attentive",
    debug: {
      slot,
      route: payload.route?.kind || null,
      permissions: payload.audience?.permissions || [],
      ticketCount: Array.isArray(payload.projectOs?.tickets) ? payload.projectOs.tickets.length : 0
    }
  };
};

export const createBrainGatewayHandler = () => async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "iroharness-brain-gateway",
      slots: ["voice", "text"]
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
    writeJson(response, 200, responseFor({ slot, payload }));
  } catch (error) {
    writeJson(response, 400, {
      error: "invalid_brain_request",
      message: error.message
    });
  }
};

const runningDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (runningDirectly) {
  const server = createServer(createBrainGatewayHandler());

  server.listen(port, "127.0.0.1", () => {
    console.log(`IroHarness demo brain gateway: http://127.0.0.1:${port}`);
    console.log(`voice=http://127.0.0.1:${port}/voice`);
    console.log(`text=http://127.0.0.1:${port}/text`);
  });

  process.once("SIGINT", () => {
    server.close(() => process.exit(0));
  });
}
