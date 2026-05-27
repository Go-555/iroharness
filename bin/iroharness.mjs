#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { createFileUserRegistry } from "../src/index.js";

const usage = `IroHarness

Usage:
  iroharness init [dir] [--name <package-name>] [--character <character-name>] [--force]
  iroharness audience user [dir] --id <user-id> [--display-name <name>] [--role <role>] [--youtube <id>] [--discord <id>]
  iroharness audience link [dir] --user <user-id> --platform <platform> --platform-user-id <id>
  iroharness audience grant [dir] --user <user-id> --permission <permission> [--scope <scope>] [--expires-at <iso-date>]
  iroharness audience stream [dir] --id <stream-id> --platform <platform> --channel <channel-id>
  iroharness audience list [dir] [--json]
  iroharness doctor [dir] [--production] [--json]
  iroharness --help

Examples:
  iroharness init ./my-companion --character Iroha
  iroharness audience user ./my-companion --id keita --display-name Keita --role developer --youtube UCxxx --discord 123456
  iroharness audience grant ./my-companion --user keita --permission manage_stream --scope stream:youtube
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
    if (["--youtube", "--discord", "--slack", "--vscode", "--browser", "--m5stack", "--even-g2"].includes(value)) {
      identities[value.slice(2)] = rest[index + 1];
      index += 1;
      continue;
    }
    if (!value.startsWith("-")) {
      positional.push(value);
    }
  }
  if (command === "audience") {
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

userRegistry.registerUser({
  id: "owner-local",
  displayName: "Local Owner",
  role: "owner",
  relationship: "owner",
  identities: {
    browser: "browser-guest",
    local: "owner"
  }
});

const companion = createIroHarness({
  character,
  projectOs,
  userRegistry,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
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

console.log(\`${character.name} companion server: \${url}\`);
console.log(\`Audience admin: \${url}/?view=admin\`);
console.log(\`Health: \${url}/health\`);
console.log(\`OpenAPI: \${url}/openapi.json\`);

if (process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_LIVE_CHAT_ID) {
  userRegistry.createStreamSession({
    id: \`youtube_\${process.env.YOUTUBE_LIVE_CHAT_ID}\`,
    platform: "youtube",
    platformChannelId: process.env.YOUTUBE_LIVE_CHAT_ID,
    title: process.env.YOUTUBE_STREAM_TITLE || \`${character.name} YouTube Live\`,
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
    path: join(targetDir, "SOUL.md"),
    force,
    content: `# ${character}\n\nA character macro harness that owns identity, PJOS, permissions, and expression.\n`
  });
  writeFile({
    path: join(targetDir, "IDENTITY.md"),
    force,
    content: `# Identity\n\nName: ${character}\n\nThis file is the stable identity layer for the character.\n`
  });
  writeFile({
    path: join(targetDir, "MEMORY.md"),
    force,
    content: "# Memory\n\nDurable facts and relationship context go here.\n"
  });
  writeFile({
    path: join(targetDir, "VOICE.md"),
    force,
    content: "# Voice\n\nShort, natural, responsive, and consistent across text and speech.\n"
  });
  writeFile({
    path: join(targetDir, ".env.example"),
    force,
    content: [
      "PORT=4178",
      "IROHARNESS_ADMIN_TOKEN=",
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
    content: "node_modules\n.env\n.iroharness/*.json\n"
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
  const gitignorePath = join(targetDir, ".gitignore");
  const gitignoreText = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
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
          label: ".iroharness JSON state is ignored",
          ok: gitignoreText.split(/\r?\n/).some((line) => line.trim() === ".iroharness/*.json")
        }
      ]
    : [];
  const allChecks = [...checks, ...productionChecks];
  const missing = checks.filter((check) => !check.ok);
  const failedProductionChecks = productionChecks.filter((check) => !check.ok);
  return {
    targetDir,
    ok: missing.length === 0 && failedProductionChecks.length === 0,
    checks: allChecks,
    missing,
    failedProductionChecks,
    production
  };
};

const audienceRegistry = (dir) =>
  createFileUserRegistry({
    path: join(resolve(dir), ".iroharness", "users.json")
  });

const requireValue = (value, label) => {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
};

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
  if (args.action === "list") {
    const snapshot = registry.snapshot();
    printAudienceResult({
      json: args.json,
      result: snapshot,
      summary: [
        `users: ${snapshot.users.length}`,
        `identities: ${snapshot.userIdentities.length}`,
        `permission overrides: ${snapshot.permissionOverrides.length}`,
        `stream sessions: ${snapshot.streamSessions.length}`
      ].join("\n")
    });
    return;
  }
  throw new Error(`Unknown audience action: ${args.action || "(missing)"}\n\n${usage}`);
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
