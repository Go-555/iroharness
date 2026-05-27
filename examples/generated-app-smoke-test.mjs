import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (args, { cwd = process.cwd(), env = {} } = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: node ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
};

const workspace = mkdtempSync(join(tmpdir(), "iroharness-generated-app-"));
const appDir = join(workspace, "companion");
const cli = join(process.cwd(), "bin", "iroharness.mjs");

run([cli, "init", appDir, "--name", "smoke-companion", "--character", "SmokeIroha"]);

[
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "VOICE.md",
  "README.md",
  ".env.example",
  "src/app.mjs"
].forEach((file) => {
  assert.equal(existsSync(join(appDir, file)), true, `${file} should exist`);
});

const agents = readFileSync(join(appDir, "AGENTS.md"), "utf8");
const app = readFileSync(join(appDir, "src", "app.mjs"), "utf8");
assert.match(agents, /macro harness owns character identity/);
assert.match(agents, /Check permissions before deep discussion/);
assert.match(app, /createFileUserRegistry/);
assert.match(app, /createIroHarnessDevServer/);

run([cli, "doctor", appDir]);
const production = run([cli, "doctor", appDir, "--production", "--json"], {
  env: {
    IROHARNESS_ADMIN_TOKEN: "smoke-generated-app-token"
  }
});
const productionReport = JSON.parse(production.stdout);
assert.equal(productionReport.ok, true);
assert.equal(productionReport.production, true);

run([
  cli,
  "audience",
  "user",
  appDir,
  "--id",
  "owner",
  "--display-name",
  "Owner",
  "--role",
  "owner",
  "--youtube",
  "UC-smoke",
  "--discord",
  "discord-smoke"
]);

const audience = run([cli, "audience", "list", appDir, "--json"]);
const snapshot = JSON.parse(audience.stdout);
assert.equal(snapshot.users.length, 1);
assert.equal(snapshot.users[0].identities.youtube, "UC-smoke");
assert.equal(snapshot.users[0].identities.discord, "discord-smoke");

console.log(
  JSON.stringify(
    {
      ok: true,
      appDir,
      checks: ["init", "doctor", "doctor:production", "audience:user", "audience:list"]
    },
    null,
    2
  )
);
