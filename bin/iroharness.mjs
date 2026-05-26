#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const usage = `IroHarness

Usage:
  iroharness init [dir] [--name <package-name>] [--character <character-name>] [--force]
  iroharness doctor [dir]
  iroharness --help

Examples:
  iroharness init ./my-companion --character Iroha
  iroharness doctor ./my-companion
`;

const parseArgs = (argv) => {
  const [command = "--help", ...rest] = argv;
  let dir = ".";
  let name = null;
  let character = "Iroha";
  let force = false;

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
    if (!value.startsWith("-")) {
      dir = value;
    }
  }

  return {
    command,
    dir,
    name,
    character,
    force
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
        start: "node src/app.mjs"
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

## Character

${character} is the macro harness identity. Models, micro harnesses, and body
adapters are engines or interfaces. They do not replace the character.

Edit SOUL.md, IDENTITY.md, and MEMORY.md to change the character profile.
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
    path: join(targetDir, ".gitignore"),
    force,
    content: "node_modules\n.iroharness/*.json\n"
  });

  return {
    targetDir,
    packageName,
    character
  };
};

const doctor = ({ dir }) => {
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
      label: ".iroharness",
      path: join(targetDir, ".iroharness")
    }
  ].map((check) => ({
    ...check,
    ok: existsSync(check.path)
  }));
  const missing = checks.filter((check) => !check.ok);
  return {
    targetDir,
    ok: missing.length === 0,
    checks,
    missing
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
      console.log(`${check.ok ? "ok" : "missing"} ${check.label}`);
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
