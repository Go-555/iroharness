import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const runCli = (args, { env = {} } = {}) =>
  spawnSync(process.execPath, [join(process.cwd(), "bin", "iroharness.mjs"), ...args], {
    cwd: process.cwd(),
    env: Object.fromEntries(
      Object.entries({
        ...process.env,
        ...env
      }).filter(([, value]) => value !== undefined)
    ),
    encoding: "utf8"
  });

const waitForServerUrl = (child) =>
  new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for generated app server. Output:\n${output}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/companion server: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Generated app exited early with code ${code}. Output:\n${output}`));
      }
    });
  });

const stopChild = async (child) => {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
};

test("CLI init creates a minimal IroHarness app", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-init-"));
  const appDir = join(dir, "companion");

  const result = runCli(["init", appDir, "--name", "companion-app", "--character", "Iroha"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created companion-app/);
  assert.equal(existsSync(join(appDir, "package.json")), true);
  assert.equal(existsSync(join(appDir, "src", "app.mjs")), true);
  assert.equal(existsSync(join(appDir, "SOUL.md")), true);
  assert.equal(existsSync(join(appDir, "IDENTITY.md")), true);
  assert.equal(existsSync(join(appDir, "MEMORY.md")), true);
  assert.equal(existsSync(join(appDir, "VOICE.md")), true);
  assert.equal(existsSync(join(appDir, ".env.example")), true);
  assert.equal(existsSync(join(appDir, ".iroharness")), true);

  const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  const app = readFileSync(join(appDir, "src", "app.mjs"), "utf8");

  assert.equal(packageJson.dependencies.iroharness, "^0.1.0");
  assert.equal(packageJson.scripts.doctor, "iroharness doctor .");
  assert.equal(packageJson.scripts["doctor:production"], "iroharness doctor . --production");
  assert.match(app, /createFileCharacterProfile/);
  assert.match(app, /createIroHarness/);
  assert.match(app, /createHttpBrain/);
  assert.match(app, /createConfiguredBrain/);
  assert.match(app, /IROHARNESS_VOICE_BRAIN_ENDPOINT/);
  assert.match(app, /IROHARNESS_DEEP_BRAIN_ENDPOINT/);
  assert.match(app, /IROHARNESS_BRAIN_AUTH_TOKEN/);
  assert.match(app, /loadEnvFile/);
  assert.match(app, /existsSync/);
  assert.match(app, /process\.env\[key\] === undefined/);
  assert.match(app, /createYouTubeLiveChatPollingRuntime/);
  assert.match(app, /createDiscordBotRuntime/);
  assert.match(app, /createObsStreamController/);
  assert.match(app, /IROHARNESS_ENABLE_OBS/);
  assert.match(app, /turnEnricher: enrichTurn/);
  assert.match(app, /runtimeStatus/);
  assert.match(app, /runtimes\.map/);
  assert.match(app, /createRuntimeRecord/);
  assert.match(app, /lastErrorAt/);
  assert.match(app, /lastResultAt/);
  assert.match(app, /name: "Iroha"/);
  assert.match(app, /createFileProjectOs/);
  assert.match(app, /createFileUserRegistry/);
  assert.match(app, /createIroHarnessDevServer/);
  assert.match(app, /createMotionPngTuberRendererBridge/);
  assert.match(app, /IROHARNESS_ADMIN_TOKEN/);
  assert.match(app, /\/health/);
  assert.match(app, /\/openapi\.json/);

  const readme = readFileSync(join(appDir, "README.md"), "utf8");
  assert.match(readme, /\?view=overlay/);
  assert.match(readme, /\?view=admin/);
  assert.match(readme, /\/health/);
  assert.match(readme, /\/openapi\.json/);
  assert.match(readme, /cp \.env\.example \.env/);
  assert.match(readme, /npm run doctor/);
  assert.match(readme, /IROHARNESS_ADMIN_TOKEN/);
  assert.match(readme, /IROHARNESS_VOICE_BRAIN_ENDPOINT/);
  assert.match(readme, /IROHARNESS_DEEP_BRAIN_ENDPOINT/);
  assert.match(readme, /actor, audience, route, state, and/);
  assert.match(readme, /VOICE\.md/);
  assert.match(readme, /npx iroharness audience user/);
  assert.match(readme, /npx iroharness audience list \. --json/);
  assert.match(readme, /OBS Browser Source URL/);

  const envExample = readFileSync(join(appDir, ".env.example"), "utf8");
  assert.match(envExample, /PORT=4178/);
  assert.match(envExample, /IROHARNESS_ADMIN_TOKEN=/);
  assert.match(envExample, /IROHARNESS_BRAIN_AUTH_TOKEN=/);
  assert.match(envExample, /IROHARNESS_VOICE_BRAIN_ENDPOINT=/);
  assert.match(envExample, /IROHARNESS_TEXT_BRAIN_MODEL=/);
  assert.match(envExample, /IROHARNESS_DEEP_BRAIN_ENDPOINT=/);
  assert.match(envExample, /YOUTUBE_API_KEY=/);
  assert.match(envExample, /DISCORD_BOT_TOKEN=/);
  assert.match(envExample, /IROHARNESS_ENABLE_OBS=0/);
  assert.match(envExample, /OBS_WEBSOCKET_URL=/);
});

test("CLI init refuses to overwrite generated files without force", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-init-existing-"));
  const first = runCli(["init", dir]);
  const second = runCli(["init", dir]);

  assert.equal(first.status, 0, first.stderr);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);
});

test("CLI doctor validates generated companion app shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-doctor-"));
  const appDir = join(dir, "companion");
  const init = runCli(["init", appDir, "--character", "Iroha"]);
  const doctor = runCli(["doctor", appDir]);
  const jsonDoctor = runCli(["doctor", appDir, "--json"]);
  const parsed = JSON.parse(jsonDoctor.stdout);

  assert.equal(init.status, 0, init.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(jsonDoctor.status, 0, jsonDoctor.stderr);
  assert.match(doctor.stdout, /ok package\.json/);
  assert.match(doctor.stdout, /ok SOUL\.md/);
  assert.match(doctor.stdout, /ok VOICE\.md/);
  assert.match(doctor.stdout, /ok \.env\.example/);
  assert.match(doctor.stdout, /ok HTTP brain model wiring/);
  assert.match(doctor.stdout, /IroHarness project looks ready/);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.production, false);
  assert.equal(parsed.checks.some((check) => check.label === "SOUL.md" && check.ok), true);
});

test("CLI audience manages users, platform identities, permissions, and streams", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-audience-"));
  const appDir = join(dir, "companion");
  const init = runCli(["init", appDir, "--character", "Iroha"]);
  const user = runCli([
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
    "UCOWNER",
    "--discord",
    "DOWNER"
  ]);
  const link = runCli([
    "audience",
    "link",
    appDir,
    "--user",
    "owner",
    "--platform",
    "slack",
    "--platform-user-id",
    "UOWNER"
  ]);
  const grant = runCli([
    "audience",
    "grant",
    appDir,
    "--user",
    "owner",
    "--permission",
    "manage_stream",
    "--scope",
    "stream:youtube",
    "--expires-at",
    "2099-01-01T00:00:00Z"
  ]);
  const revoke = runCli([
    "audience",
    "revoke",
    appDir,
    "--user",
    "owner",
    "--permission",
    "manage_stream",
    "--scope",
    "stream:youtube"
  ]);
  const grantAgain = runCli([
    "audience",
    "grant",
    appDir,
    "--user",
    "owner",
    "--permission",
    "manage_stream",
    "--scope",
    "stream:youtube",
    "--expires-at",
    "2099-01-01T00:00:00Z"
  ]);
  const stream = runCli([
    "audience",
    "stream",
    appDir,
    "--id",
    "youtube-live",
    "--platform",
    "youtube",
    "--channel",
    "live-chat-id",
    "--host",
    "owner"
  ]);
  const list = runCli(["audience", "list", appDir, "--json"]);
  const snapshot = JSON.parse(list.stdout);

  assert.equal(init.status, 0, init.stderr);
  assert.equal(user.status, 0, user.stderr);
  assert.equal(link.status, 0, link.stderr);
  assert.equal(grant.status, 0, grant.stderr);
  assert.equal(revoke.status, 0, revoke.stderr);
  assert.equal(grantAgain.status, 0, grantAgain.stderr);
  assert.equal(stream.status, 0, stream.stderr);
  assert.equal(list.status, 0, list.stderr);
  assert.match(user.stdout, /registered user owner/);
  assert.match(link.stdout, /linked slack:UOWNER -> owner/);
  assert.match(grant.stdout, /allow manage_stream for owner in stream:youtube/);
  assert.match(grant.stdout, /2099-01-01T00:00:00.000Z/);
  assert.match(revoke.stdout, /revoked manage_stream for owner in stream:youtube/);
  assert.match(stream.stdout, /registered stream youtube-live/);
  assert.equal(snapshot.users[0].id, "owner");
  assert.equal(snapshot.users[0].identities.youtube, "UCOWNER");
  assert.equal(snapshot.users[0].identities.discord, "DOWNER");
  assert.equal(snapshot.users[0].identities.slack, "UOWNER");
  assert.equal(snapshot.permissionOverrides[0].permission, "manage_stream");
  assert.equal(snapshot.permissionOverrides[0].expiresAt, "2099-01-01T00:00:00.000Z");
  assert.equal(snapshot.streamSessions[0].platformChannelId, "live-chat-id");
});

test("CLI doctor production profile requires a strong admin token", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-doctor-production-"));
  const appDir = join(dir, "companion");
  const init = runCli(["init", appDir, "--character", "Iroha"]);
  const missingToken = runCli(["doctor", appDir, "--production"], {
    env: {
      IROHARNESS_ADMIN_TOKEN: ""
    }
  });
  const shortToken = runCli(["doctor", appDir, "--production"], {
    env: {
      IROHARNESS_ADMIN_TOKEN: "short"
    }
  });
  writeFileSync(join(appDir, ".env"), "IROHARNESS_ADMIN_TOKEN=env-file-token-123\n", "utf8");
  const readyFromEnvFile = runCli(["doctor", appDir, "--production"], {
    env: {
      IROHARNESS_ADMIN_TOKEN: undefined
    }
  });
  const ready = runCli(["doctor", appDir, "--production"], {
    env: {
      IROHARNESS_ADMIN_TOKEN: "production-token-123"
    }
  });

  assert.equal(init.status, 0, init.stderr);
  assert.notEqual(missingToken.status, 0);
  assert.match(missingToken.stdout, /failed IROHARNESS_ADMIN_TOKEN/);
  assert.notEqual(shortToken.status, 0);
  assert.match(shortToken.stdout, /failed IROHARNESS_ADMIN_TOKEN length >= 16/);
  assert.equal(readyFromEnvFile.status, 0, readyFromEnvFile.stderr);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /ok audience admin token wiring/);
  assert.match(ready.stdout, /ok \.env is ignored/);
  assert.match(ready.stdout, /ok \.iroharness JSON state is ignored/);
});

test("CLI generated app starts a local companion server", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-generated-server-"));
  const appDir = join(dir, "companion");
  const init = runCli(["init", appDir, "--name", "companion-app", "--character", "Iroha"]);
  assert.equal(init.status, 0, init.stderr);

  mkdirSync(join(appDir, "node_modules"), { recursive: true });
  symlinkSync(process.cwd(), join(appDir, "node_modules", "iroharness"), "dir");

  const child = spawn(process.execPath, ["src/app.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const url = await waitForServerUrl(child);
    const [openapi, state, health] = await Promise.all([
      fetch(`${url}/openapi.json`).then((response) => response.json()),
      fetch(`${url}/state`).then((response) => response.json()),
      fetch(`${url}/health`).then((response) => response.json())
    ]);

    assert.equal(openapi.openapi, "3.1.0");
    assert.equal(state.characterId, "iroha");
    assert.equal(health.characterId, "iroha");
    assert.equal(existsSync(join(appDir, ".iroharness", "users.json")), true);
  } catch (error) {
    if (String(error.message).includes("listen EPERM")) {
      context.skip("local port binding is not permitted in this sandbox");
      return;
    }
    throw error;
  } finally {
    await stopChild(child);
  }
});

test("CLI doctor fails when character profile files are missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-doctor-missing-"));
  const doctor = runCli(["doctor", dir]);
  const jsonDoctor = runCli(["doctor", dir, "--json"]);
  const parsed = JSON.parse(jsonDoctor.stdout);

  assert.notEqual(doctor.status, 0);
  assert.notEqual(jsonDoctor.status, 0);
  assert.match(doctor.stdout, /missing package\.json/);
  assert.match(doctor.stdout, /missing SOUL\.md/);
  assert.match(doctor.stderr, /project check failed/);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.missing.some((check) => check.label === "package.json"), true);
  assert.equal(jsonDoctor.stderr.trim(), "");
});
