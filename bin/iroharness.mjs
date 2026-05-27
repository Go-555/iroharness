#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const usage = `IroHarness

Usage:
  iroharness init [dir] [--name <package-name>] [--character <character-name>] [--force]
  iroharness doctor [dir] [--production]
  iroharness --help

Examples:
  iroharness init ./my-companion --character Iroha
  iroharness doctor ./my-companion
  IROHARNESS_ADMIN_TOKEN=... iroharness doctor ./my-companion --production
`;

const parseArgs = (argv) => {
  const [command = "--help", ...rest] = argv;
  let dir = ".";
  let name = null;
  let character = "Iroha";
  let force = false;
  let production = false;

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
    if (!value.startsWith("-")) {
      dir = value;
    }
  }

  return {
    command,
    dir,
    name,
    character,
    force,
    production
  };
};

const writeFile = ({ path, content, force }) => {
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists. Use --force to overwrite generated files.`);
  }
  writeFileSync(path, content, "utf8");
};

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
  return `import {
  createEchoBrain,
  createFileCharacterProfile,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createIroHarness,
  createRecorderDevice,
  createStubMicroHarness
} from "iroharness";
import {
  createEventStreamDevice,
  createIroHarnessDevServer,
  createMotionPngTuberRendererBridge,
  createM5StackBodyBridge,
  createEvenG2DisplayBridge,
  createLive2DBodyBridge,
  createVrmBodyBridge
} from "iroharness/adapters";

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
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"]),
    createStubMicroHarness("openclaw", ["assistant", "tools"]),
    createStubMicroHarness("hermes", ["learning", "skills"])
  ]
});

const app = createIroHarnessDevServer({
  harness: companion,
  userRegistry,
  adminToken: process.env.IROHARNESS_ADMIN_TOKEN || null,
  eventStream,
  bodyDevices
});

const { url } = await app.listen({
  port: Number(process.env.PORT || 4178)
});

console.log(\`${character.name} companion server: \${url}\`);
console.log(\`Audience admin: \${url}/?view=admin\`);
console.log(\`OpenAPI: \${url}/openapi.json\`);
`;
};

const readme = ({ name, character }) => `# ${name}

Generated with IroHarness.

## Run

\`\`\`bash
npm install
npm start
\`\`\`

The app starts a local browser companion server:

- \`/\` for browser chat
- \`/?view=overlay\` for OBS Browser Source
- \`/?view=admin\` for audience, identity, permission, and stream setup
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
      "OBS_WEBSOCKET_URL=ws://127.0.0.1:4455",
      "OBS_WEBSOCKET_PASSWORD=",
      "OBS_OVERLAY_INPUT=IroHarness Overlay",
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
  const productionChecks = production
    ? [
        {
          label: "IROHARNESS_ADMIN_TOKEN",
          ok: Boolean(process.env.IROHARNESS_ADMIN_TOKEN)
        },
        {
          label: "IROHARNESS_ADMIN_TOKEN length >= 16",
          ok: String(process.env.IROHARNESS_ADMIN_TOKEN || "").length >= 16
        },
        {
          label: "audience admin token wiring",
          ok: appSourceText.includes("adminToken: process.env.IROHARNESS_ADMIN_TOKEN")
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

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "--help" || args.command === "-h" || args.command === "help") {
    console.log(usage);
    return;
  }
  if (args.command === "doctor") {
    const result = doctor(args);
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
