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
  assert.match(app, /loadEnvFile/);
  assert.match(app, /existsSync/);
  assert.match(app, /process\.env\[key\] === undefined/);
  assert.match(app, /createYouTubeLiveChatPollingRuntime/);
  assert.match(app, /createDiscordBotRuntime/);
  assert.match(app, /createObsStreamController/);
  assert.match(app, /IROHARNESS_ENABLE_OBS/);
  assert.match(app, /turnEnricher: enrichTurn/);
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
  assert.match(readme, /VOICE\.md/);

  const envExample = readFileSync(join(appDir, ".env.example"), "utf8");
  assert.match(envExample, /PORT=4178/);
  assert.match(envExample, /IROHARNESS_ADMIN_TOKEN=/);
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

  assert.equal(init.status, 0, init.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /ok package\.json/);
  assert.match(doctor.stdout, /ok SOUL\.md/);
  assert.match(doctor.stdout, /ok VOICE\.md/);
  assert.match(doctor.stdout, /ok \.env\.example/);
  assert.match(doctor.stdout, /IroHarness project looks ready/);
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

  assert.notEqual(doctor.status, 0);
  assert.match(doctor.stdout, /missing package\.json/);
  assert.match(doctor.stdout, /missing SOUL\.md/);
  assert.match(doctor.stderr, /project check failed/);
});
