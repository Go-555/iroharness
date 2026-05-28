#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { createFileUserRegistry, createProjectOsMarkdown } from "../src/index.js";

const usage = `IroHarness

Usage:
  iroharness init [dir] [--name <package-name>] [--character <character-name>] [--force]
  iroharness audience user [dir] --id <user-id> [--display-name <name>] [--role <role>] [--youtube <id>] [--discord <id>]
  iroharness audience link [dir] --user <user-id> --platform <platform> --platform-user-id <id>
  iroharness audience grant [dir] --user <user-id> --permission <permission> [--scope <scope>] [--expires-at <iso-date>]
  iroharness audience revoke [dir] --user <user-id> --permission <permission> [--scope <scope>]
  iroharness audience stream [dir] --id <stream-id> --platform <platform> --channel <channel-id>
  iroharness audience export [dir] [--file <path>] [--json]
  iroharness audience import [dir] --file <path> --force
  iroharness audience list [dir] [--json]
  iroharness connect slack [dir] [--bot-token <xoxb-token>] [--signing-secret <secret>] [--bot-user-id <user-id>] [--owner-slack-user-id <user-id>]
  iroharness connect stackchan [dir] [--host-url <url>] [--wifi-ssid <ssid>] [--wifi-pass <password>] [--device-id <id>] [--device-token <token>] [--poll-interval-ms <ms>]
  iroharness view export [dir] --zone <public|trusted|owner> --out <view-dir> [--force]
  iroharness doctor [dir] [--production] [--json]
  iroharness --help

Examples:
  iroharness init ./my-companion --character Iroha
  iroharness audience user ./my-companion --id keita --display-name Keita --role developer --youtube UCxxx --discord 123456
  iroharness audience grant ./my-companion --user keita --permission manage_stream --scope stream:youtube
  iroharness audience revoke ./my-companion --user keita --permission manage_stream --scope stream:youtube
  iroharness audience export ./my-companion --file ./audience-backup.json
  iroharness audience import ./my-companion --file ./audience-backup.json --force
  iroharness connect slack ./my-companion --owner-slack-user-id UOWNER
  iroharness connect stackchan ./my-companion --host-url http://100.64.0.10:4182
  iroharness view export ./my-companion --zone trusted --out /Users/iroharness-trusted/iroha-view --force
  iroharness doctor ./my-companion
  IROHARNESS_ADMIN_TOKEN=... iroharness doctor ./my-companion --production
  iroharness doctor ./my-companion --production --json
`;

const parseArgs = (argv) => {
  const [command = "--help", ...rest] = argv;
  let dir = ".";
  let name = null;
  let character = "Iroha";
  let force = false;
  let production = false;
  let json = false;
  let action = null;
  let userId = null;
  let displayName = null;
  let role = "fan";
  let relationship = null;
  let platform = null;
  let platformUserId = null;
  let permission = null;
  let scope = "global";
  let effect = "allow";
  let reason = null;
  let expiresAt = null;
  let channel = null;
  let title = null;
  let hostUserId = null;
  let file = null;
  let botToken = null;
  let signingSecret = null;
  let botUserId = null;
  let ownerSlackUserId = null;
  let hostUrl = null;
  let wifiSsid = null;
  let wifiPass = null;
  let deviceId = "stackchan";
  let deviceToken = null;
  let pollIntervalMs = "500";
  let zone = null;
  let out = null;
  const identities = {};
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--name") {
      name = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--character") {
      character = rest[index + 1] || character;
      index += 1;
      continue;
    }
    if (value === "--force") {
      force = true;
      continue;
    }
    if (value === "--production") {
      production = true;
      continue;
    }
    if (value === "--json") {
      json = true;
      continue;
    }
    if (value === "--id") {
      userId = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--user") {
      userId = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--display-name") {
      displayName = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--role") {
      role = rest[index + 1] || role;
      index += 1;
      continue;
    }
    if (value === "--relationship") {
      relationship = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--platform") {
      platform = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--platform-user-id") {
      platformUserId = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--permission") {
      permission = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--scope") {
      scope = rest[index + 1] || scope;
      index += 1;
      continue;
    }
    if (value === "--effect") {
      effect = rest[index + 1] || effect;
      index += 1;
      continue;
    }
    if (value === "--reason") {
      reason = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--expires-at") {
      expiresAt = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--channel") {
      channel = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--title") {
      title = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--host") {
      hostUserId = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--file") {
      file = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--bot-token") {
      botToken = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--signing-secret") {
      signingSecret = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--bot-user-id") {
      botUserId = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--owner-slack-user-id") {
      ownerSlackUserId = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--host-url") {
      hostUrl = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--wifi-ssid") {
      wifiSsid = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--wifi-pass") {
      wifiPass = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--device-id") {
      deviceId = rest[index + 1] || deviceId;
      index += 1;
      continue;
    }
    if (value === "--device-token") {
      deviceToken = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--poll-interval-ms") {
      pollIntervalMs = rest[index + 1] || pollIntervalMs;
      index += 1;
      continue;
    }
    if (value === "--zone") {
      zone = rest[index + 1];
      index += 1;
      continue;
    }
    if (value === "--out") {
      out = rest[index + 1];
      index += 1;
      continue;
    }
    if (["--youtube", "--discord", "--slack", "--vscode", "--browser", "--m5stack", "--even-g2"].includes(value)) {
      identities[value.slice(2)] = rest[index + 1];
      index += 1;
      continue;
    }
    if (!value.startsWith("-")) {
      positional.push(value);
    }
  }
  if (command === "audience" || command === "connect" || command === "view") {
    [action = null, dir = "."] = positional;
  } else if (positional.length > 0) {
    dir = positional[positional.length - 1];
  }

  return {
    command,
    action,
    dir,
    name,
    character,
    force,
    production,
    json,
    userId,
    displayName,
    role,
    relationship,
    platform,
    platformUserId,
    permission,
    scope,
    effect,
    reason,
    expiresAt,
    channel,
    title,
    hostUserId,
    file,
    botToken,
    signingSecret,
    botUserId,
    ownerSlackUserId,
    hostUrl,
    wifiSsid,
    wifiPass,
    deviceId,
    deviceToken,
    pollIntervalMs,
    zone,
    out,
    identities
  };
};

const writeFile = ({ path, content, force }) => {
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists. Use --force to overwrite generated files.`);
  }
  writeFileSync(path, content, "utf8");
};

const parseEnvText = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "")
        ];
      })
      .filter(([key]) => key)
  );

const readEnvFile = (path) =>
  existsSync(path) ? parseEnvText(readFileSync(path, "utf8")) : {};

const packageJson = ({ name }) =>
  `${JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "node src/app.mjs",
        doctor: "iroharness doctor .",
        "doctor:production": "iroharness doctor . --production"
      },
      dependencies: {
        iroharness: "^0.1.0"
      }
    },
    null,
    2
  )}\n`;

const characterId = (name) =>
  String(name || "iroha")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "iroha";

const appSource = ({ character }) => {
  const id = characterId(character);
  return `import { existsSync, readFileSync } from "node:fs";

import {
  createEchoBrain,
  createFileCharacterProfile,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createHttpBrain,
  createIroHarness,
  createRecorderDevice,
  createRecorderStreamController,
  createStubMicroHarness
} from "iroharness";
import {
  createDiscordBotRuntime,
  createDiscordMessageAdapter,
  createEventStreamDevice,
  createIroHarnessDevServer,
  createObsStreamController,
  createObsWebSocketAdapter,
  createMotionPngTuberRendererBridge,
  createM5StackBodyBridge,
  createEvenG2DisplayBridge,
  createLive2DBodyBridge,
  createVrmBodyBridge,
  createSnapshotStreamSessionResolver,
  createStreamContextEnricher,
  createYouTubeLiveChatPollingRuntime
} from "iroharness/adapters";

const loadEnvFile = (path = ".env") => {
  if (!existsSync(path)) {
    return;
  }
  readFileSync(path, "utf8")
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .forEach((line) => {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
};

loadEnvFile();

const projectOs = createFileProjectOs({
  path: ".iroharness/pjos.json"
});
const userRegistry = createFileUserRegistry({
  path: ".iroharness/users.json"
});
const eventStream = createEventStreamDevice("browser-events");
const recorder = createRecorderDevice("recorder");
const bodyDevices = [
  createMotionPngTuberRendererBridge(),
  createM5StackBodyBridge(),
  createEvenG2DisplayBridge(),
  createLive2DBodyBridge(),
  createVrmBodyBridge()
];
const streamController =
  process.env.IROHARNESS_ENABLE_OBS === "1"
    ? createObsStreamController({
        obs: createObsWebSocketAdapter({
          url: process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455",
          password: process.env.OBS_WEBSOCKET_PASSWORD || null
        }),
        overlayInputName: process.env.OBS_OVERLAY_INPUT || "IroHarness Overlay",
        overlayUrl: process.env.IROHARNESS_OVERLAY_URL || "http://127.0.0.1:4178/?view=overlay",
        defaultSceneName: process.env.OBS_SCENE_NAME || null
      })
    : createRecorderStreamController("stream-recorder");
const enrichTurn = createStreamContextEnricher({
  resolveStreamSession: createSnapshotStreamSessionResolver({
    snapshot: () => userRegistry.snapshot()
  })
});

const character = createFileCharacterProfile({
  dir: ".",
  id: "${id}",
  name: "${character}"
});

const brainAuthHeaders = () =>
  process.env.IROHARNESS_BRAIN_AUTH_TOKEN
    ? { authorization: \`Bearer \${process.env.IROHARNESS_BRAIN_AUTH_TOKEN}\` }
    : {};

const brainSlotEnv = Object.freeze({
  voice: {
    endpoint: "IROHARNESS_VOICE_BRAIN_ENDPOINT",
    model: "IROHARNESS_VOICE_BRAIN_MODEL",
    id: "IROHARNESS_VOICE_BRAIN_ID"
  },
  text: {
    endpoint: "IROHARNESS_TEXT_BRAIN_ENDPOINT",
    model: "IROHARNESS_TEXT_BRAIN_MODEL",
    id: "IROHARNESS_TEXT_BRAIN_ID"
  },
  deep: {
    endpoint: "IROHARNESS_DEEP_BRAIN_ENDPOINT",
    model: "IROHARNESS_DEEP_BRAIN_MODEL",
    id: "IROHARNESS_DEEP_BRAIN_ID"
  }
});

const createConfiguredBrain = ({ slot, fallbackId }) => {
  const env = brainSlotEnv[slot];
  const endpoint = process.env[env.endpoint];
  if (!endpoint) {
    return createEchoBrain(fallbackId);
  }
  return createHttpBrain({
    id: process.env[env.id] || \`\${slot}-http\`,
    endpoint,
    model: process.env[env.model] || null,
    headers: brainAuthHeaders()
  });
};

const voiceBrain = createConfiguredBrain({
  slot: "voice",
  fallbackId: "voice-fast"
});
const textBrain = createConfiguredBrain({
  slot: "text",
  fallbackId: "text-deep"
});
const deepBrain = process.env.IROHARNESS_DEEP_BRAIN_ENDPOINT
  ? createConfiguredBrain({
      slot: "deep",
      fallbackId: "deep-reasoning"
    })
  : null;
const brains = Object.freeze({
  voice: voiceBrain,
  text: textBrain,
  ...(deepBrain ? { deep: deepBrain } : {})
});

userRegistry.registerUser({
  id: "owner-local",
  displayName: "Local Owner",
  role: "owner",
  relationship: "owner",
  identities: {
    local: "owner"
  }
});

const companion = createIroHarness({
  character,
  projectOs,
  userRegistry,
  router: createHeuristicRouter(),
  brains,
  devices: [eventStream, recorder, ...bodyDevices],
  streamController,
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"]),
    createStubMicroHarness("openclaw", ["assistant", "tools"]),
    createStubMicroHarness("hermes", ["learning", "skills"])
  ]
});

const runtimes = [];
const createRuntimeRecord = (id, runtime) => {
  const record = {
    id,
    runtime,
    lastReadyAt: null,
    lastResultAt: null,
    lastErrorAt: null,
    lastError: null
  };
  runtimes.push(record);
  return record;
};

const app = createIroHarnessDevServer({
  harness: companion,
  userRegistry,
  adminToken: process.env.IROHARNESS_ADMIN_TOKEN || null,
  eventStream,
  bodyDevices,
  turnEnricher: enrichTurn,
  runtimeStatus: () =>
    runtimes.map(({ id, runtime, lastReadyAt, lastResultAt, lastErrorAt, lastError }) => ({
      id,
      state: typeof runtime.state === "function" ? runtime.state() : { active: true },
      lastReadyAt,
      lastResultAt,
      lastErrorAt,
      lastError
    }))
});

const { url } = await app.listen({
  port: Number(process.env.PORT || 4178)
});

console.log(\`\${character.name} companion server: \${url}\`);
console.log(\`Audience admin: \${url}/?view=admin\`);
console.log(\`Health: \${url}/health\`);
console.log(\`OpenAPI: \${url}/openapi.json\`);

if (process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_LIVE_CHAT_ID) {
  userRegistry.createStreamSession({
    id: \`youtube_\${process.env.YOUTUBE_LIVE_CHAT_ID}\`,
    platform: "youtube",
    platformChannelId: process.env.YOUTUBE_LIVE_CHAT_ID,
    title: process.env.YOUTUBE_STREAM_TITLE || \`\${character.name} YouTube Live\`,
    status: "live"
  });
  let youtubeRecord = null;
  const youtube = createYouTubeLiveChatPollingRuntime({
    apiKey: process.env.YOUTUBE_API_KEY,
    liveChatId: process.env.YOUTUBE_LIVE_CHAT_ID,
    harness: companion,
    turnEnricher: enrichTurn,
    onResult({ turn, result }) {
      youtubeRecord.lastResultAt = new Date().toISOString();
      console.log(\`youtube \${turn.actor.displayName}: \${result.kind}\`);
    },
    onError(error) {
      youtubeRecord.lastErrorAt = new Date().toISOString();
      youtubeRecord.lastError = error.message;
      console.error(\`youtube runtime error: \${error.message}\`);
    }
  });
  youtubeRecord = createRuntimeRecord("youtube", youtube);
  youtube.start();
  console.log("YouTube live chat runtime started");
}

if (process.env.DISCORD_BOT_TOKEN) {
  let discordRecord = null;
  const discord = createDiscordBotRuntime({
    token: process.env.DISCORD_BOT_TOKEN,
    harness: companion,
    adapter: createDiscordMessageAdapter({
      mentionOnly: process.env.DISCORD_MENTION_ONLY !== "0",
      botUserId: process.env.DISCORD_BOT_USER_ID || null
    }),
    turnEnricher: enrichTurn,
    onReady({ botUserId }) {
      discordRecord.lastReadyAt = new Date().toISOString();
      console.log(\`Discord runtime ready: \${botUserId}\`);
    },
    onError(error) {
      discordRecord.lastErrorAt = new Date().toISOString();
      discordRecord.lastError = error.message;
      console.error(\`discord runtime error: \${error.message}\`);
    }
  });
  discordRecord = createRuntimeRecord("discord", discord);
  discord.start();
  console.log("Discord runtime started");
}

process.once("SIGINT", async () => {
  runtimes.forEach(({ runtime }) => runtime.stop?.());
  await app.close();
  process.exit(0);
});
`;
};

const readme = ({ name, character }) => `# ${name}

Generated with IroHarness.

## Run

\`\`\`bash
npm install
cp .env.example .env
npm start
\`\`\`

The app starts a local browser companion server:

- \`/\` for browser chat
- \`/?view=overlay\` for OBS Browser Source
- \`/?view=admin\` for audience, identity, permission, and stream setup
- \`/health\` for process, character, body, platform, and PJOS readiness
- \`/openapi.json\` for the local HTTP API contract

## Safety Check

\`\`\`bash
npm run doctor
IROHARNESS_ADMIN_TOKEN="replace-with-a-long-random-token" npm run doctor:production
\`\`\`

Set \`IROHARNESS_ADMIN_TOKEN\` before exposing this server through Tailscale,
a tunnel, reverse proxy, Discord, YouTube, or OBS tooling.

## Brain Routing

The same ${character} identity can use different models by mode:

- \`IROHARNESS_VOICE_BRAIN_ENDPOINT\`: low-latency voice replies
- \`IROHARNESS_TEXT_BRAIN_ENDPOINT\`: normal chat replies
- \`IROHARNESS_DEEP_BRAIN_ENDPOINT\`: developer-level deep discussion

Each endpoint receives the same character, actor, audience, route, state, and
PJOS context. Use \`IROHARNESS_BRAIN_AUTH_TOKEN\` when your model gateway needs
a bearer token.

## Character

${character} is the macro harness identity. Models, micro harnesses, and body
adapters are engines or interfaces. They do not replace the character.

Edit SOUL.md, IDENTITY.md, MEMORY.md, and VOICE.md to change the character
profile.

## Audience Setup

Link the same person across YouTube and Discord before going live:

\`\`\`bash
npx iroharness audience user . --id owner --display-name "Owner" --role owner --youtube UCxxx --discord 123456
npx iroharness audience stream . --id youtube-live --platform youtube --channel "$YOUTUBE_LIVE_CHAT_ID" --host owner
npx iroharness audience grant . --user owner --permission manage_stream --scope stream:youtube
npx iroharness audience list . --json
\`\`\`

OBS Browser Source URL:

\`\`\`text
http://127.0.0.1:4178/?view=overlay
\`\`\`
`;

const agentsMd = ({ character }) => `# ${character} Companion Agent Instructions

This app is an IroHarness companion. The macro harness owns character identity,
memory, audience permissions, Project OS state, and routing.

## Session Start

Before taking action, read these files in this app directory:

1. \`SOUL.md\` for personality, tone, boundaries, and stable behavior
2. \`IDENTITY.md\` for who the character is
3. \`MEMORY.md\` for durable facts and relationship context
4. \`VOICE.md\` for spoken style and low-latency reply constraints

## Invariants

- ${character} remains the same character across browser, OBS, YouTube,
  Discord, Slack, VS Code, M5Stack, Even G2, Live2D, VRM, and future bodies.
- Platform identities such as YouTube IDs and Discord IDs must resolve through
  the audience registry before permissions or relationship are inferred.
- Permissions change what an actor may do; they do not change the character's
  identity.
- Check permissions before deep discussion, work delegation, stream control, or
  user management.
- Record long-running work in Project OS instead of relying on chat history.
- Treat Codex, Claude Code, OpenClaw, Hermes, local scripts, and provider
  models as engines or workers. They are not automatically the character.

## File Boundaries

- Character profile: \`SOUL.md\`, \`IDENTITY.md\`, \`MEMORY.md\`, \`VOICE.md\`
- Runtime state: \`.iroharness/\`
- App code: \`src/app.mjs\`
- Local secrets: \`.env\`

Do not commit \`.env\` or \`.iroharness/\`.
`;

const init = ({ dir, name, character, force }) => {
  const targetDir = resolve(dir);
  const packageName = name || basename(targetDir) || "iroharness-app";
  mkdirSync(join(targetDir, "src"), { recursive: true });
  mkdirSync(join(targetDir, ".iroharness"), { recursive: true });

  writeFile({
    path: join(targetDir, "package.json"),
    force,
    content: packageJson({ name: packageName })
  });
  writeFile({
    path: join(targetDir, "src", "app.mjs"),
    force,
    content: appSource({ character })
  });
  writeFile({
    path: join(targetDir, "README.md"),
    force,
    content: readme({ name: packageName, character })
  });
  writeFile({
    path: join(targetDir, "AGENTS.md"),
    force,
    content: agentsMd({ character })
  });
  writeFile({
    path: join(targetDir, "SOUL.md"),
    force,
    content: `# ${character}

${character} is a character macro harness identity.

## Personality

- Consistent across text, voice, browser, OBS, YouTube, Discord, and devices
- Direct, warm, and practical
- Helpful without pretending that external tools or models are the character

## Boundaries

- Keep identity in the macro harness
- Use audience permissions before privileged actions
- Use Project OS for long-running work and decisions
- Treat models, micro harnesses, and bodies as replaceable engines or interfaces
`
  });
  writeFile({
    path: join(targetDir, "IDENTITY.md"),
    force,
    content: `# Identity

Name: ${character}

This file is the stable identity layer for the character. ${character} remains
the same character even when the reply engine, body renderer, platform, or
micro harness changes.
`
  });
  writeFile({
    path: join(targetDir, "MEMORY.md"),
    force,
    content: `# Memory

Durable facts and relationship context go here.

Use this file for stable, human-reviewed facts. Use Project OS for tickets,
runs, artifacts, and work state. Use the audience registry for platform IDs,
roles, scoped permissions, and stream sessions.
`
  });
  writeFile({
    path: join(targetDir, "VOICE.md"),
    force,
    content: `# Voice

Short, natural, responsive, and consistent across text and speech.

Voice replies should prefer low latency. If deeper reasoning is needed, say so
briefly and route the work to the text/deep brain or a micro harness while
keeping ${character}'s identity stable.
`
  });
  writeFile({
    path: join(targetDir, ".env.example"),
    force,
    content: [
      "PORT=4178",
      "IROHARNESS_ADMIN_TOKEN=",
      "IROHARNESS_BRAIN_AUTH_TOKEN=",
      "IROHARNESS_VOICE_BRAIN_ENDPOINT=",
      "IROHARNESS_VOICE_BRAIN_MODEL=",
      "IROHARNESS_TEXT_BRAIN_ENDPOINT=",
      "IROHARNESS_TEXT_BRAIN_MODEL=",
      "IROHARNESS_DEEP_BRAIN_ENDPOINT=",
      "IROHARNESS_DEEP_BRAIN_MODEL=",
      "YOUTUBE_API_KEY=",
      "YOUTUBE_LIVE_CHAT_ID=",
      "DISCORD_BOT_TOKEN=",
      "DISCORD_BOT_USER_ID=",
      "DISCORD_MENTION_ONLY=1",
      "IROHARNESS_ENABLE_OBS=0",
      "OBS_WEBSOCKET_URL=ws://127.0.0.1:4455",
      "OBS_WEBSOCKET_PASSWORD=",
      "OBS_OVERLAY_INPUT=IroHarness Overlay",
      "IROHARNESS_OVERLAY_URL=http://127.0.0.1:4178/?view=overlay",
      "OBS_SCENE_NAME=",
      ""
    ].join("\n")
  });
  writeFile({
    path: join(targetDir, ".gitignore"),
    force,
    content: "node_modules\n.env\n.iroharness/\n"
  });

  return {
    targetDir,
    packageName,
    character
  };
};

const doctor = ({ dir, production = false }) => {
  const targetDir = resolve(dir);
  const checks = [
    {
      label: "package.json",
      path: join(targetDir, "package.json")
    },
    {
      label: "src/app.mjs",
      path: join(targetDir, "src", "app.mjs")
    },
    {
      label: "AGENTS.md",
      path: join(targetDir, "AGENTS.md")
    },
    {
      label: "SOUL.md",
      path: join(targetDir, "SOUL.md")
    },
    {
      label: "IDENTITY.md",
      path: join(targetDir, "IDENTITY.md")
    },
    {
      label: "MEMORY.md",
      path: join(targetDir, "MEMORY.md")
    },
    {
      label: "VOICE.md",
      path: join(targetDir, "VOICE.md")
    },
    {
      label: ".env.example",
      path: join(targetDir, ".env.example")
    },
    {
      label: ".iroharness",
      path: join(targetDir, ".iroharness")
    }
  ].map((check) => ({
    ...check,
    ok: existsSync(check.path)
  }));
  const appPath = join(targetDir, "src", "app.mjs");
  const appSourceText = existsSync(appPath) ? readFileSync(appPath, "utf8") : "";
  const agentsPath = join(targetDir, "AGENTS.md");
  const agentsText = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const gitignorePath = join(targetDir, ".gitignore");
  const gitignoreText = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const appSourceChecks = [
    {
      label: "HTTP brain model wiring",
      ok:
        appSourceText.includes("createHttpBrain") &&
        appSourceText.includes("IROHARNESS_VOICE_BRAIN_ENDPOINT")
    },
    {
      label: "agent boundary instructions",
      ok:
        agentsText.includes("macro harness owns character identity") &&
        agentsText.includes("Check permissions before deep discussion") &&
        agentsText.includes("Record long-running work in Project OS")
    }
  ];
  const env = {
    ...readEnvFile(join(targetDir, ".env")),
    ...process.env
  };
  const productionChecks = production
    ? [
        {
          label: "IROHARNESS_ADMIN_TOKEN",
          ok: Boolean(env.IROHARNESS_ADMIN_TOKEN)
        },
        {
          label: "IROHARNESS_ADMIN_TOKEN length >= 16",
          ok: String(env.IROHARNESS_ADMIN_TOKEN || "").length >= 16
        },
        {
          label: "audience admin token wiring",
          ok: appSourceText.includes("adminToken: process.env.IROHARNESS_ADMIN_TOKEN")
        },
        {
          label: ".env is ignored",
          ok: gitignoreText.split(/\r?\n/).some((line) => line.trim() === ".env")
        },
        {
          label: ".iroharness runtime state is ignored",
          ok: gitignoreText.split(/\r?\n/).some((line) => line.trim() === ".iroharness/")
        }
      ]
    : [];
  const allChecks = [...checks, ...appSourceChecks, ...productionChecks];
  const missing = checks.filter((check) => !check.ok);
  const failedAppSourceChecks = appSourceChecks.filter((check) => !check.ok);
  const failedProductionChecks = productionChecks.filter((check) => !check.ok);
  return {
    targetDir,
    ok:
      missing.length === 0 &&
      failedAppSourceChecks.length === 0 &&
      failedProductionChecks.length === 0,
    checks: allChecks,
    missing,
    failedAppSourceChecks,
    failedProductionChecks,
    production
  };
};

const audienceRegistry = (dir) =>
  createFileUserRegistry({
    path: join(resolve(dir), ".iroharness", "users.json")
  });

const audienceRegistryPath = (dir) => join(resolve(dir), ".iroharness", "users.json");

const requireValue = (value, label) => {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
};

const assertAudienceSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("audience backup must be a JSON object");
  }
  ["users", "userIdentities", "permissionOverrides", "streamSessions"].forEach((key) => {
    if (!Array.isArray(snapshot[key])) {
      throw new Error(`audience backup requires array field ${key}`);
    }
  });
  if (snapshot.auditLog && !Array.isArray(snapshot.auditLog)) {
    throw new Error("audience backup field auditLog must be an array when present");
  }
  return {
    ...snapshot,
    auditLog: snapshot.auditLog || []
  };
};

const readAudienceBackup = (path) =>
  assertAudienceSnapshot(JSON.parse(readFileSync(path, "utf8")));

const writeJsonFile = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const readJsonFile = (path) => JSON.parse(readFileSync(path, "utf8"));

const envLineValue = (value) => {
  const text = String(value || "");
  return /^[A-Za-z0-9_./:@-]*$/.test(text) ? text : JSON.stringify(text);
};

const mergeEnvFile = (path, entries) => {
  const existing = existsSync(path) ? readEnvFile(path) : {};
  const merged = {
    ...existing,
    ...Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== null))
  };
  const content = `${Object.entries(merged)
    .map(([key, value]) => `${key}=${envLineValue(value)}`)
    .join("\n")}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return merged;
};

const normalizeBaseUrl = (value) => String(value || "http://127.0.0.1:4182").replace(/\/+$/g, "");

const createSecretToken = () => randomBytes(24).toString("base64url");

const redactConnectionSecrets = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => redactConnectionSecrets(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/pass|password|secret|token/i.test(key)) {
        return [key, item ? "[redacted]" : item];
      }
      return [key, redactConnectionSecrets(item)];
    })
  );
};

const sanitizeViewJson = (value) => redactConnectionSecrets(value);

const copyViewFile = ({ sourceRoot, targetRoot, sourcePath, targetPath = sourcePath, files }) => {
  const source = join(sourceRoot, sourcePath);
  if (!existsSync(source)) {
    return;
  }
  const target = join(targetRoot, targetPath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  files.push(targetPath);
};

const writeViewText = ({ targetRoot, targetPath, content, files }) => {
  const target = join(targetRoot, targetPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  files.push(targetPath);
};

const writeViewJson = ({ targetRoot, targetPath, value, files }) => {
  writeJsonFile(join(targetRoot, targetPath), value);
  files.push(targetPath);
};

const optionalTextFile = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);

const defaultPublicMemory = `# Public Memory

No public memory has been exported yet.
`;

const memoryLayer = ({ sourceRoot, name, sourcePath, fallback = null }) => {
  const content = optionalTextFile(join(sourceRoot, sourcePath)) || fallback;
  if (!content) {
    return null;
  }
  return {
    name,
    content: content.endsWith("\n") ? content : `${content}\n`
  };
};

const exportMemoryFiles = ({ sourceRoot, targetRoot, zone, files }) => {
  const layers = [
    memoryLayer({
      sourceRoot,
      name: "public",
      sourcePath: join("memory", "public.md"),
      fallback: defaultPublicMemory
    }),
    ...(zone !== "public"
      ? [
          memoryLayer({
            sourceRoot,
            name: "trusted",
            sourcePath: join("memory", "trusted.md")
          })
        ]
      : []),
    ...(zone === "owner"
      ? [
          memoryLayer({
            sourceRoot,
            name: "owner",
            sourcePath: join("memory", "owner.md"),
            fallback: optionalTextFile(join(sourceRoot, "MEMORY.md"))
          })
        ]
      : [])
  ].filter(Boolean);

  const aggregate = layers
    .map(({ name, content }) => `<!-- iroharness-memory-layer: ${name} -->\n${content}`)
    .join("\n");

  writeViewText({
    targetRoot,
    targetPath: "MEMORY.md",
    content: aggregate,
    files
  });

  layers.forEach(({ name, content }) => {
    writeViewText({
      targetRoot,
      targetPath: `MEMORY.${name}.md`,
      content,
      files
    });
  });
};

const viewZoneRank = Object.freeze({
  public: 0,
  trusted: 1,
  owner: 2
});

const normalizeVisibility = (value) => {
  const normalized = String(value || "owner").toLowerCase();
  if (["public", "external"].includes(normalized)) {
    return "public";
  }
  if (["trusted", "team", "internal"].includes(normalized)) {
    return "trusted";
  }
  return "owner";
};

const visibilityForProjectOsItem = (item) =>
  normalizeVisibility(
    item?.visibility ||
      item?.zone ||
      item?.metadata?.visibility ||
      item?.metadata?.zone ||
      item?.metadata?.view
  );

const canExposeProjectOsItem = ({ item, zone }) =>
  viewZoneRank[visibilityForProjectOsItem(item)] <= viewZoneRank[zone];

const emptyProjectOsSnapshot = () => ({
  tickets: [],
  runs: [],
  artifacts: []
});

const normalizeProjectOsSnapshot = (snapshot) => ({
  tickets: Array.isArray(snapshot?.tickets) ? snapshot.tickets : [],
  runs: Array.isArray(snapshot?.runs) ? snapshot.runs : [],
  artifacts: Array.isArray(snapshot?.artifacts) ? snapshot.artifacts : []
});

const filterProjectOsForZone = ({ snapshot, zone }) => {
  const normalized = normalizeProjectOsSnapshot(snapshot);
  const tickets = normalized.tickets.filter((ticket) =>
    canExposeProjectOsItem({ item: ticket, zone })
  );
  const visibleTicketIds = new Set(tickets.map((ticket) => ticket.id));
  const runs = normalized.runs.filter((run) => {
    if (run.ticketId && visibleTicketIds.has(run.ticketId)) {
      return true;
    }
    return !run.ticketId && canExposeProjectOsItem({ item: run, zone });
  });
  const visibleRunIds = new Set(runs.map((run) => run.id));
  const artifacts = normalized.artifacts.filter((artifact) => {
    if (artifact.ticketId && visibleTicketIds.has(artifact.ticketId)) {
      return true;
    }
    if (artifact.runId && visibleRunIds.has(artifact.runId)) {
      return true;
    }
    return (
      !artifact.ticketId &&
      !artifact.runId &&
      canExposeProjectOsItem({ item: artifact, zone })
    );
  });
  return sanitizeViewJson({
    tickets,
    runs,
    artifacts
  });
};

const readProjectOsSnapshot = (sourceRoot) => {
  const source = join(sourceRoot, ".iroharness", "pjos.json");
  if (!existsSync(source)) {
    return emptyProjectOsSnapshot();
  }
  return normalizeProjectOsSnapshot(readJsonFile(source));
};

const exportProjectOsFiles = ({ sourceRoot, targetRoot, zone, files }) => {
  const snapshot = filterProjectOsForZone({
    snapshot: readProjectOsSnapshot(sourceRoot),
    zone
  });
  writeViewJson({
    targetRoot,
    targetPath: "project-os.json",
    value: snapshot,
    files
  });
  writeViewText({
    targetRoot,
    targetPath: "PROJECT_OS.md",
    content: createProjectOsMarkdown(snapshot),
    files
  });
  return snapshot;
};

const viewConnectionFilesForZone = (zone) => {
  if (zone === "public") {
    return Object.freeze([]);
  }
  if (zone === "trusted") {
    return Object.freeze(["slack.json", "stackchan.device.json"]);
  }
  return Object.freeze(["slack.json", "stackchan.device.json"]);
};

const exportConnectionFiles = ({ sourceRoot, targetRoot, zone, files }) => {
  const connectionDir = join(sourceRoot, ".iroharness", "connections");
  viewConnectionFilesForZone(zone).forEach((fileName) => {
    const source = join(connectionDir, fileName);
    if (!existsSync(source)) {
      return;
    }
    writeViewJson({
      targetRoot,
      targetPath: join("connections", fileName),
      value: sanitizeViewJson(readJsonFile(source)),
      files
    });
  });
};

const exportView = (args) => {
  if (args.action !== "export") {
    throw new Error(`Unknown view action: ${args.action || "(missing)"}\n\n${usage}`);
  }
  const zone = requireValue(args.zone, "--zone");
  if (!["public", "trusted", "owner"].includes(zone)) {
    throw new Error("--zone must be public, trusted, or owner");
  }
  const sourceRoot = resolve(args.dir);
  const viewRoot = resolve(requireValue(args.out, "--out"));
  const currentRoot = join(viewRoot, "current");
  if (existsSync(currentRoot) && !args.force) {
    throw new Error(`${currentRoot} already exists. Use --force to replace generated view files.`);
  }
  rmSync(currentRoot, { recursive: true, force: true });
  mkdirSync(currentRoot, { recursive: true });
  mkdirSync(join(viewRoot, "state", "logs"), { recursive: true });
  mkdirSync(join(viewRoot, "state", "proposals"), { recursive: true });

  const files = [];
  ["SOUL.md", "IDENTITY.md", "VOICE.md"].forEach((fileName) => {
    copyViewFile({ sourceRoot, targetRoot: currentRoot, sourcePath: fileName, files });
  });
  exportMemoryFiles({ sourceRoot, targetRoot: currentRoot, zone, files });
  const projectOs = exportProjectOsFiles({ sourceRoot, targetRoot: currentRoot, zone, files });
  exportConnectionFiles({ sourceRoot, targetRoot: currentRoot, zone, files });

  const manifestFiles = [...files, "view-manifest.json"].sort();
  const manifest = {
    kind: "iroharness.view",
    zone,
    source: sourceRoot,
    exportedAt: new Date().toISOString(),
    files: manifestFiles,
    statePath: join(viewRoot, "state"),
    projectOs: {
      defaultVisibility: "owner",
      visibilityRule:
        "public views see public items; trusted views see public and trusted items; owner views see all items",
      counts: {
        tickets: projectOs.tickets.length,
        runs: projectOs.runs.length,
        artifacts: projectOs.artifacts.length
      }
    },
    rules: {
      coreReadableByRunner: false,
      envCopied: false,
      secretsCopied: false,
      unknownFilesAllowed: false
    }
  };
  writeViewJson({ targetRoot: currentRoot, targetPath: "view-manifest.json", value: manifest, files });
  return {
    sourceRoot,
    viewRoot,
    currentRoot,
    manifest
  };
};

const createCliAuditRecord = ({ action, resourceType, resourceId, metadata = {} }) => ({
  id: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  action,
  resourceType,
  resourceId,
  userId: null,
  metadata,
  createdAt: new Date().toISOString()
});

const optionalIsoDate = (value, label) => {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    throw new Error(`${label} must be a valid ISO date`);
  }
  return new Date(time).toISOString();
};

const printAudienceResult = ({ json, result, summary }) => {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(summary);
};

const audience = (args) => {
  if (args.action === "import") {
    const backupPath = resolve(requireValue(args.file, "--file"));
    const targetPath = audienceRegistryPath(args.dir);
    if (existsSync(targetPath) && !args.force) {
      throw new Error("audience import overwrites existing state; pass --force to continue");
    }
    const snapshot = readAudienceBackup(backupPath);
    const importedSnapshot = {
      ...snapshot,
      auditLog: [
        ...snapshot.auditLog,
        createCliAuditRecord({
          action: "audience.backup.import",
          resourceType: "audienceStore",
          resourceId: targetPath,
          metadata: { backupPath }
        })
      ]
    };
    writeJsonFile(targetPath, importedSnapshot);
    const imported = audienceRegistry(args.dir).snapshot();
    printAudienceResult({
      json: args.json,
      result: {
        path: targetPath,
        snapshot: imported
      },
      summary: `imported audience backup from ${backupPath} to ${targetPath}`
    });
    return;
  }
  const registry = audienceRegistry(args.dir);
  if (args.action === "user") {
    const user = registry.registerUser({
      id: requireValue(args.userId, "--id"),
      displayName: args.displayName || args.userId,
      role: args.role,
      relationship: args.relationship || args.role,
      identities: Object.fromEntries(
        Object.entries(args.identities).filter(([, value]) => Boolean(value))
      )
    });
    printAudienceResult({
      json: args.json,
      result: user,
      summary: `registered user ${user.id} (${user.role})`
    });
    return;
  }
  if (args.action === "link") {
    const identity = registry.linkIdentity({
      userId: requireValue(args.userId, "--user"),
      platform: requireValue(args.platform, "--platform"),
      platformUserId: requireValue(args.platformUserId, "--platform-user-id"),
      displayName: args.displayName
    });
    printAudienceResult({
      json: args.json,
      result: identity,
      summary: `linked ${identity.platform}:${identity.platformUserId} -> ${identity.userId}`
    });
    return;
  }
  if (args.action === "grant") {
    const override = registry.setPermissionOverride({
      userId: requireValue(args.userId, "--user"),
      permission: requireValue(args.permission, "--permission"),
      effect: args.effect,
      scope: args.scope,
      reason: args.reason,
      expiresAt: optionalIsoDate(args.expiresAt, "--expires-at")
    });
    const expiry = override.expiresAt ? ` until ${override.expiresAt}` : "";
    printAudienceResult({
      json: args.json,
      result: override,
      summary: `${override.effect} ${override.permission} for ${override.userId} in ${override.scope}${expiry}`
    });
    return;
  }
  if (args.action === "revoke") {
    const result = registry.deletePermissionOverride({
      userId: requireValue(args.userId, "--user"),
      permission: requireValue(args.permission, "--permission"),
      scope: args.scope
    });
    printAudienceResult({
      json: args.json,
      result,
      summary: `${result.deleted ? "revoked" : "not found"} ${result.permission} for ${result.userId} in ${result.scope}`
    });
    return;
  }
  if (args.action === "stream") {
    const stream = registry.createStreamSession({
      id: requireValue(args.userId, "--id"),
      platform: requireValue(args.platform, "--platform"),
      platformChannelId: requireValue(args.channel, "--channel"),
      title: args.title,
      hostUserId: args.hostUserId
    });
    printAudienceResult({
      json: args.json,
      result: stream,
      summary: `registered stream ${stream.id} (${stream.platform}:${stream.platformChannelId})`
    });
    return;
  }
  if (args.action === "export") {
    const snapshot = registry.snapshot();
    if (!args.file) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }
    const backupPath = resolve(args.file);
    writeJsonFile(backupPath, snapshot);
    printAudienceResult({
      json: args.json,
      result: {
        path: backupPath,
        snapshot
      },
      summary: `exported audience backup to ${backupPath}`
    });
    return;
  }
  if (args.action === "list") {
    const snapshot = registry.snapshot();
    printAudienceResult({
      json: args.json,
      result: snapshot,
      summary: [
        `users: ${snapshot.users.length}`,
        `identities: ${snapshot.userIdentities.length}`,
        `permission overrides: ${snapshot.permissionOverrides.length}`,
        `stream sessions: ${snapshot.streamSessions.length}`,
        `audit records: ${snapshot.auditLog.length}`
      ].join("\n")
    });
    return;
  }
  throw new Error(`Unknown audience action: ${args.action || "(missing)"}\n\n${usage}`);
};

const connectSlack = (args) => {
  const targetDir = resolve(args.dir);
  const connectionDir = join(targetDir, ".iroharness", "connections");
  const envPath = join(targetDir, ".env");
  mkdirSync(connectionDir, { recursive: true });
  const ownerSlackUserId = args.ownerSlackUserId || "UOWNER";
  mergeEnvFile(envPath, {
    SLACK_BOT_TOKEN: args.botToken || "xoxb-...",
    SLACK_SIGNING_SECRET: args.signingSecret || "...",
    SLACK_BOT_USER_ID: args.botUserId || "UIROHA",
    SLACK_MENTION_ONLY: "1",
    IROHARNESS_SLACK_OWNER_USER_ID: ownerSlackUserId
  });
  const connection = {
    id: "slack",
    kind: "interface",
    preset: "slack-text",
    envFile: ".env",
    requiredEnv: [
      "SLACK_BOT_TOKEN",
      "SLACK_SIGNING_SECRET",
      "SLACK_BOT_USER_ID",
      "IROHARNESS_SLACK_OWNER_USER_ID"
    ],
    body: {
      kind: "presence",
      optional: true
    },
    nextSteps: [
      "Create a Slack app and enable Events API.",
      "Set the Events Request URL to /slack/events on the running host.",
      "Use npm run example:slack-stackchan for the current Slack + StackChan prototype."
    ]
  };
  const connectionPath = join(connectionDir, "slack.json");
  writeJsonFile(connectionPath, connection);
  if (args.ownerSlackUserId) {
    audienceRegistry(args.dir).registerUser({
      id: "owner",
      displayName: "Owner",
      role: "owner",
      relationship: "owner",
      identities: {
        slack: ownerSlackUserId
      }
    });
  }
  return {
    targetDir,
    envPath,
    connectionPath,
    connection
  };
};

const connectStackChan = (args) => {
  const targetDir = resolve(args.dir);
  const connectionDir = join(targetDir, ".iroharness", "connections");
  const envPath = join(targetDir, ".env");
  mkdirSync(connectionDir, { recursive: true });
  const baseUrl = normalizeBaseUrl(args.hostUrl);
  const deviceId = args.deviceId || "stackchan";
  const deviceToken = args.deviceToken || createSecretToken();
  const pollIntervalMs = Number(args.pollIntervalMs || "500");
  mergeEnvFile(envPath, {
    STACKCHAN_DEVICE_TOKEN: deviceToken
  });
  const deviceConfig = {
    deviceId,
    kind: "stackchan",
    server: {
      baseUrl,
      facePath: "/stackchan/face",
      invokePath: "/device/stackchan/invoke",
      eventsPath: `/body/${deviceId}/events`
    },
    wifiNetworks: [
      {
        name: "default",
        ssid: args.wifiSsid || "YOUR_WIFI_SSID",
        pass: args.wifiPass || "YOUR_WIFI_PASSWORD"
      }
    ],
    display: {
      rotation: 0,
      brightness: 180,
      statusOverlayEnabled: true
    },
    invokeTemplates: {
      touch: "$StackChanのボタンが押されました。短く反応してください。",
      vision: "$見えているものに反応してください。",
      ptt: "$StackChanから音声入力が届きました。短く反応してください。"
    },
    metadata: {
      connectionMode: "http-polling",
      auth: "x-iroharness-device-token"
    }
  };
  const firmwareConfig = {
    wifi_ssid: args.wifiSsid || "YOUR_WIFI_SSID",
    wifi_pass: args.wifiPass || "YOUR_WIFI_PASSWORD",
    face_url: `${baseUrl}/stackchan/face`,
    invoke_url: `${baseUrl}/device/stackchan/invoke`,
    device_token: deviceToken,
    device_id: deviceId,
    poll_interval_ms: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 500
  };
  const deviceConfigPath = join(connectionDir, "stackchan.device.json");
  const firmwareConfigPath = join(connectionDir, "stackchan-firmware-config.json");
  writeJsonFile(deviceConfigPath, deviceConfig);
  writeJsonFile(firmwareConfigPath, firmwareConfig);
  return {
    targetDir,
    envPath,
    deviceConfigPath,
    firmwareConfigPath,
    deviceConfig,
    firmwareConfig
  };
};

const connect = (args) => {
  if (args.action === "slack") {
    const result = connectSlack(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`configured Slack in ${result.targetDir}`);
    console.log(`env: ${result.envPath}`);
    console.log(`connection: ${result.connectionPath}`);
    console.log("next: fill real Slack values in .env, then expose /slack/events on the running host");
    return;
  }
  if (args.action === "stackchan") {
    const result = connectStackChan(args);
    if (args.json) {
      console.log(JSON.stringify(redactConnectionSecrets(result), null, 2));
      return;
    }
    console.log(`configured StackChan in ${result.targetDir}`);
    console.log(`device config: ${result.deviceConfigPath}`);
    console.log(`firmware config: ${result.firmwareConfigPath}`);
    console.log("next: copy firmware config values into examples/stackchan-face-poller/data/config.json");
    return;
  }
  throw new Error(`Unknown connect target: ${args.action || "(missing)"}\n\n${usage}`);
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "--help" || args.command === "-h" || args.command === "help") {
    console.log(usage);
    return;
  }
  if (args.command === "doctor") {
    const result = doctor(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }
    result.checks.forEach((check) => {
      const status = check.ok ? "ok" : check.path ? "missing" : "failed";
      console.log(`${status} ${check.label}`);
    });
    if (!result.ok) {
      throw new Error(`IroHarness project check failed in ${result.targetDir}`);
    }
    console.log(`IroHarness project looks ready: ${result.targetDir}`);
    return;
  }
  if (args.command === "audience") {
    audience(args);
    return;
  }
  if (args.command === "connect") {
    connect(args);
    return;
  }
  if (args.command === "view") {
    const result = exportView(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`exported ${result.manifest.zone} view to ${result.currentRoot}`);
    console.log(`files: ${result.manifest.files.length}`);
    return;
  }
  if (args.command !== "init") {
    throw new Error(`Unknown command: ${args.command}\n\n${usage}`);
  }
  const result = init(args);
  console.log(`Created ${result.packageName} in ${result.targetDir}`);
  console.log(`Character: ${result.character}`);
  console.log("Next: npm install && npm start");
};

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
