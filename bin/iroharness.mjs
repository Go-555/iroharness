#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const usage = `IroHarness

Usage:
  iroharness init [dir] [--name <package-name>] [--character <character-name>] [--force]
  iroharness --help

Examples:
  iroharness init ./my-companion --character Iroha
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
  createConsoleDevice,
  createEchoBrain,
  createFileProjectOs,
  createHeuristicRouter,
  createIroHarness,
  createStubMicroHarness
} from "iroharness";

const projectOs = createFileProjectOs({
  path: ".iroharness/pjos.json"
});

const companion = createIroHarness({
  character: {
    id: "${id}",
    name: "${character}",
    soul: "A character macro harness that owns identity, PJOS, permissions, and expression.",
    voiceStyle: "short, responsive, natural"
  },
  projectOs,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-deep")
  },
  devices: [createConsoleDevice("console")],
  microHarnesses: [
    createStubMicroHarness("codex", ["code", "files", "review"]),
    createStubMicroHarness("openclaw", ["assistant", "tools"]),
    createStubMicroHarness("hermes", ["learning", "skills"])
  ]
});

await companion.receive({
  source: "local",
  modality: "text",
  actor: {
    platform: "local",
    platformUserId: "owner",
    displayName: "Owner"
  },
  text: "こんにちは。まず自己紹介して。"
});
`;
};

const readme = ({ name, character }) => `# ${name}

Generated with IroHarness.

## Run

\`\`\`bash
npm install
npm start
\`\`\`

## Character

${character} is the macro harness identity. Models, micro harnesses, and body
adapters are engines or interfaces. They do not replace the character.
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

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "--help" || args.command === "-h" || args.command === "help") {
    console.log(usage);
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
