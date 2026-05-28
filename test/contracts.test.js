import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createEchoBrain } from "../src/index.js";
import {
  createEventStreamDevice,
  createHttpMicroHarness,
  createOpenClawMicroHarness
} from "../src/adapters/index.js";
import {
  assertBrainContract,
  assertDeviceContract,
  assertMicroHarnessContract
} from "../src/testing/index.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(join("fixtures", "golden", name), "utf8"));
const readProtocol = (name) => JSON.parse(readFileSync(join("protocols", name), "utf8"));

test("micro harness contract validates generic HTTP adapters with golden fixture", async () => {
  const { task, context } = readFixture("micro-task.json");
  const adapter = createHttpMicroHarness({
    id: "fixture-http",
    endpoint: "http://127.0.0.1:8787/run",
    capabilities: ["code"],
    fetchImpl: async (_endpoint, options) => {
      const payload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "completed",
            summary: `validated ${payload.task.id}`,
            artifacts: [{ kind: "log", uri: "memory://contract", title: "contract log" }]
          });
        }
      };
    }
  });

  const result = await assertMicroHarnessContract(adapter, { task, context });

  assert.equal(result.adapterId, "fixture-http");
  assert.equal(result.status, "completed");
  assert.equal(result.summary, "validated ticket_golden_001");
  assert.equal(result.artifacts.length, 1);
});

test("micro harness contract validates named OpenClaw bridge", async () => {
  const { task, context } = readFixture("micro-task.json");
  const adapter = createOpenClawMicroHarness({
    endpoint: "http://127.0.0.1:8787/openclaw/run",
    fetchImpl: async (_endpoint, options) => {
      const payload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            reply: `openclaw accepted ${payload.task.id}`
          });
        }
      };
    }
  });

  const result = await assertMicroHarnessContract(adapter, { task, context });

  assert.equal(result.adapterId, "openclaw");
  assert.equal(result.summary, "openclaw accepted ticket_golden_001");
});

test("device contract validates event-stream compatible bodies", async () => {
  const { events } = readFixture("body-events.json");
  const device = createEventStreamDevice("contract-events");

  const result = await assertDeviceContract(device, { events });

  assert.equal(result.adapterId, "contract-events");
  assert.equal(result.eventCount, 3);
  assert.equal(device.events().length, 3);
});

test("brain contract validates response engines with golden context", async () => {
  const { context } = readFixture("brain-context.json");
  const brain = createEchoBrain("contract-brain");

  const result = await assertBrainContract(brain, { context });

  assert.equal(result.adapterId, "contract-brain");
  assert.equal(result.emotion, "attentive");
  assert.match(result.text, /Iroha/);
});

test("contract tester rejects malformed adapters", async () => {
  const { task, context } = readFixture("micro-task.json");

  await assert.rejects(
    () => assertMicroHarnessContract({ id: "broken", capabilities: [] }, { task, context }),
    /microHarness.run/
  );
});

test("realtime core JSONL command and message schemas cover golden fixtures", () => {
  const commandSchema = readProtocol("realtime-core-command.schema.json");
  const messageSchema = readProtocol("realtime-core-message.schema.json");
  const command = readFixture("realtime-core-command.json");
  const message = readFixture("realtime-core-message.json");

  commandSchema.required.forEach((field) => {
    assert.notEqual(command[field], undefined);
  });
  messageSchema.required.forEach((field) => {
    assert.notEqual(message[field], undefined);
  });

  assert.equal(commandSchema.properties.op.enum.includes(command.op), true);
  assert.equal(commandSchema.properties.op.enum.includes("shouldInterrupt"), true);
  assert.equal(command.event.type, "realtime.speaking");
  assert.equal(message.type, "ack");
  assert.equal(message.op, command.op);
  assert.equal(message.coreId, command.coreId);
});

test("speech playback queue schema covers golden fixture", () => {
  const queueSchema = readProtocol("speech-queue.schema.json");
  const queue = readFixture("speech-queue.json");

  queueSchema.required.forEach((field) => {
    assert.notEqual(queue[field], undefined);
  });

  assert.equal(queue.kind, "speech-playback-queue");
  assert.equal(queueSchema.properties.kind.const, queue.kind);
  assert.equal(
    queueSchema.$defs.speechEvent.properties.type.enum.includes("speech.interrupted"),
    true
  );
  assert.equal(queue.events[0].type, "speech.queued");
  assert.equal(queue.events[1].type, "speech.started");
});

test("StackChan realtime message schema covers golden fixture", () => {
  const messageSchema = readProtocol("stackchan-realtime-message.schema.json");
  const message = readFixture("stackchan-realtime-message.json");

  messageSchema.required.forEach((field) => {
    assert.notEqual(message[field], undefined);
  });

  assert.equal(message.type, "audio.chunk");
  assert.equal(message.final, true);
  assert.equal(messageSchema.properties.type.enum.includes("speech.audio"), true);
  assert.equal(messageSchema.properties.type.enum.includes("response.final"), true);
});

test("device config and invoke schemas cover StackChan fixtures", () => {
  const configSchema = readProtocol("device-config.schema.json");
  const invokeSchema = readProtocol("device-invoke.schema.json");
  const config = readFixture("device-config.json");
  const invoke = readFixture("device-invoke.json");
  const audioInvoke = readFixture("device-invoke-audio.json");

  configSchema.required.forEach((field) => {
    assert.notEqual(config[field], undefined);
  });
  invokeSchema.required.forEach((field) => {
    assert.notEqual(invoke[field], undefined);
    assert.notEqual(audioInvoke[field], undefined);
  });

  assert.equal(config.kind, "stackchan");
  assert.equal(config.server.facePath, "/stackchan/face");
  assert.equal(config.server.invokePath, "/device/stackchan/invoke");
  assert.equal(configSchema.properties.kind.enum.includes("stackchan"), true);
  assert.equal(invoke.type, "touch");
  assert.equal(audioInvoke.type, "audio");
  assert.equal(audioInvoke.audio.encoding, "wav");
  assert.equal(invokeSchema.properties.type.enum.includes("vision"), true);
  assert.equal(invokeSchema.properties.type.enum.includes("audio"), true);
});

test("design principles document locks the macro harness boundary", () => {
  const design = readFileSync(join("docs", "design-principles.md"), "utf8");

  [
    "The Macro Harness Owns Identity",
    "Interfaces Are Bodies",
    "Micro Harnesses Are Delegated Workers",
    "Project OS Is The Durable State Layer",
    "Permissions Are Separate From Affection",
    "Realtime Is A Replaceable Fast Path",
    "Borrow Runtimes, Own The Boundary"
  ].forEach((heading) => {
    assert.match(design, new RegExp(heading));
  });
});

test("OSS contribution metadata is present and aligned with harness boundaries", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const agents = readFileSync("AGENTS.md", "utf8");
  const readme = readFileSync("README.md", "utf8");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const installScript = readFileSync("install.sh", "utf8");
  const installGuide = readFileSync(join("docs", "install.md"), "utf8");
  const roadmap = readFileSync("ROADMAP.md", "utf8");
  const matrix = readFileSync(join("docs", "capability-matrix.md"), "utf8");
  const inspirationMap = readFileSync(join("docs", "inspiration-map.md"), "utf8");
  const inspirationHtml = readFileSync(join("docs", "inspiration-map.html"), "utf8");
  const absorptionArchitecture = readFileSync(join("docs", "absorption-architecture.md"), "utf8");
  const adapterGuide = readFileSync(join("docs", "build-an-adapter.md"), "utf8");
  const privacyGuide = readFileSync(join("docs", "privacy-and-security.md"), "utf8");
  const deploymentGuide = readFileSync(join("docs", "deployment.md"), "utf8");
  const postgresBackupGuide = readFileSync(join("docs", "postgres-backup-restore.md"), "utf8");
  const security = readFileSync("SECURITY.md", "utf8");
  const contributing = readFileSync("CONTRIBUTING.md", "utf8");
  const codeOfConduct = readFileSync("CODE_OF_CONDUCT.md", "utf8");
  const prTemplate = readFileSync(join(".github", "pull_request_template.md"), "utf8");
  const ciWorkflow = readFileSync(join(".github", "workflows", "ci.yml"), "utf8");
  const releaseWorkflow = readFileSync(join(".github", "workflows", "release.yml"), "utf8");
  const browserWorkflow = readFileSync(join(".github", "workflows", "browser-e2e.yml"), "utf8");
  const smokeTest = readFileSync(join("examples", "generated-app-smoke-test.mjs"), "utf8");
  const readinessCheck = readFileSync(join("examples", "oss-readiness-check.mjs"), "utf8");
  const publishPreflight = readFileSync(join("examples", "publish-preflight.mjs"), "utf8");
  const adapterSkeleton = readFileSync(join("examples", "adapter-skeleton.mjs"), "utf8");
  const launchd = readFileSync(join("examples", "deployment", "launchd.plist"), "utf8");
  const systemd = readFileSync(join("examples", "deployment", "systemd.service"), "utf8");
  const caddyfile = readFileSync(join("examples", "deployment", "Caddyfile"), "utf8");
  const nginx = readFileSync(join("examples", "deployment", "nginx.conf"), "utf8");
  const tailscale = readFileSync(join("examples", "deployment", "tailscale-serve.sh"), "utf8");
  const postgresBackup = readFileSync(join("examples", "postgres-audience-backup.sh"), "utf8");
  const postgresRestore = readFileSync(join("examples", "postgres-audience-restore.sh"), "utf8");
  const stackchanFirmware = readFileSync(join("docs", "stackchan-firmware.md"), "utf8");
  const slackStackchan = readFileSync(join("docs", "slack-stackchan.md"), "utf8");
  const slackStackchanExample = readFileSync(join("examples", "slack-stackchan-companion.mjs"), "utf8");
  const stackchanSimulator = readFileSync(
    join("examples", "stackchan-realtime-simulator.mjs"),
    "utf8"
  );
  const slackCodexExample = readFileSync(join("examples", "slack-codex-companion.mjs"), "utf8");
  const stackchanPoller = readFileSync(
    join("examples", "stackchan-face-poller", "src", "main.cpp"),
    "utf8"
  );

  ["AGENTS.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "install.sh"].forEach((file) => {
    assert.equal(pkg.files.includes(file), true);
  });
  assert.match(agents, /The macro harness owns character identity/);
  assert.match(agents, /Permissions gate deep discussion/);
  assert.match(agents, /Long-running work belongs in Project OS/);
  [
    join(".github", "ISSUE_TEMPLATE", "bug_report.yml"),
    join(".github", "ISSUE_TEMPLATE", "feature_request.yml"),
    join(".github", "ISSUE_TEMPLATE", "adapter_request.yml")
  ].forEach((file) => {
    assert.match(readFileSync(file, "utf8"), /IroHarness|Adapter|Feature|Bug/);
  });
  assert.match(contributing, /design-principles/);
  assert.match(contributing, /CODE_OF_CONDUCT/);
  assert.match(codeOfConduct, /private character prompts/);
  assert.match(prTemplate, /Character identity remains owned by the macro harness/);
  assert.match(prTemplate, /Permissions are checked/);
  assert.match(releaseWorkflow, /npm publish --provenance --access public/);
  assert.match(releaseWorkflow, /id-token: write/);
  assert.match(releaseWorkflow, /cargo test -p iroharness-realtime-core/);
  assert.match(releaseWorkflow, /wasm32-unknown-unknown/);
  assert.match(releaseWorkflow, /npm run smoke:generated-app/);
  assert.match(releaseWorkflow, /IROHARNESS_REQUIRE_GIT_REMOTE=1 npm run oss:ready/);
  assert.match(pkg.scripts["oss:ready"], /oss-readiness-check/);
  assert.match(pkg.scripts["oss:publish-preflight"], /publish-preflight/);
  assert.match(readme, /Generated App Checklist/);
  assert.match(readme, /npx iroharness audience user/);
  assert.match(readme, /\?view=overlay/);
  assert.match(readme, /capability-matrix/);
  assert.match(readme, /inspiration-map/);
  assert.match(readme, /absorption-architecture/);
  assert.match(readme, /build-an-adapter/);
  assert.match(readme, /docs\/deployment\.md/);
  assert.match(readme, /docs\/install\.md/);
  assert.match(readme, /docs\/postgres-backup-restore\.md/);
  assert.match(readme, /privacy-and-security/);
  assert.match(security, /privacy-and-security/);
  assert.match(contributing, /build-an-adapter/);
  [
    "OpenClaw-style `install.sh`",
    "installation guide",
    "iroharness view export",
    "HTTP brain adapters",
    "permission override expiry and revoke support",
    "file-backed audience audit log plus export/import",
    "persisted audit logs",
    "deployment guide and templates",
    "provider brain gateway recipe",
    "PostgreSQL/Supabase audience backup and restore recipes",
    "native/WASM C ABI",
    "generated app smoke test",
    "OSS readiness check",
    "publish preflight check",
    "inspiration map and HTML comparison view",
    "monorepo absorption architecture",
    "browser screenshot E2E workflow",
    "browser admin UI",
    "HTTP brain gateway demo",
    "npm release workflow"
  ].forEach((entry) => {
    assert.match(changelog, new RegExp(entry));
  });
  [
    "configurable voice/text/deep HTTP brain slots",
    "file-backed audience backup and restore CLI",
    "file-backed audit log for privileged audience changes",
    "PostgreSQL persisted audit log for privileged audience changes",
    "deployment examples for Tailscale, reverse proxy, systemd, and launchd",
    "provider brain gateway recipes for OpenAI, Claude, and local models",
    "PostgreSQL audience backup/restore recipes",
    "end-to-end browser screenshots outside sandboxed CI port restrictions",
    "Rust native/WASM C ABI implementation",
    "generated app smoke test for OSS package consumers",
    "OSS readiness check for package and repository publication",
    "publish preflight check for GitHub and npm credentials",
    "inspiration map and HTML comparison view for adjacent avatar, game SDK",
    "monorepo absorption architecture for upstream ideas",
    "browser admin UI for users, identities, permissions, revoke, and streams",
    "Production Hardening"
  ].forEach((entry) => {
    assert.match(roadmap, new RegExp(entry));
  });
  [
    "Mac mini With launchd",
    "Linux With systemd",
    "Tailscale-Only Exposure",
    "Reverse Proxy",
    "IROHARNESS_ADMIN_TOKEN"
  ].forEach((entry) => {
    assert.match(deploymentGuide, new RegExp(entry));
  });
  assert.match(matrix, /Deployment examples/);
  assert.match(launchd, /dev\.iroharness\.companion/);
  assert.match(systemd, /NoNewPrivileges=true/);
  assert.match(caddyfile, /reverse_proxy 127\.0\.0\.1:4178/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:4178/);
  assert.match(tailscale, /tailscale serve/);
  assert.match(browserWorkflow, /npm run e2e:browser-screenshots/);
  assert.match(browserWorkflow, /playwright install --with-deps chromium/);
  assert.match(browserWorkflow, /upload-artifact/);
  assert.match(ciWorkflow, /npm run smoke:generated-app/);
  assert.match(ciWorkflow, /npm run oss:ready/);
  assert.match(smokeTest, /iroharness\.mjs/);
  assert.match(smokeTest, /doctor/);
  assert.match(smokeTest, /audience/);
  assert.match(readinessCheck, /git/);
  assert.match(readinessCheck, /IROHARNESS_REQUIRE_GIT_REMOTE/);
  assert.match(readinessCheck, /\.iroharness/);
  assert.match(publishPreflight, /gh/);
  assert.match(publishPreflight, /npm/);
  assert.match(publishPreflight, /rev-parse/);
  assert.match(ciWorkflow, /cargo build -p iroharness-realtime-core --lib/);
  assert.match(ciWorkflow, /wasm32-unknown-unknown/);
  [
    "pg_dump",
    "pg_restore",
    "IROHARNESS_RESTORE_CONFIRM=restore-audience",
    "iroharness_audit_log"
  ].forEach((entry) => {
    assert.match(postgresBackupGuide, new RegExp(entry));
  });
  assert.match(matrix, /PostgreSQL audience backup\/restore/);
  assert.match(matrix, /Inspiration map/);
  assert.match(matrix, /Absorption architecture/);
  assert.match(matrix, /StackChan face poller firmware/);
  assert.match(matrix, /Device config\/invoke protocol/);
  assert.match(matrix, /OpenClaw-style installer/);
  assert.match(matrix, /Zone view export/);
  assert.match(installScript, /IROHARNESS_INSTALL_METHOD/);
  assert.match(installScript, /npm run example:slack-stackchan/);
  assert.match(installScript, /\/device\/stackchan\/invoke/);
  assert.match(installGuide, /OpenClaw/);
  assert.match(installGuide, /~\/iroharness-apps\/iroha/);
  assert.match(installGuide, /StackChan First Connection/);
  assert.match(installGuide, /MAC_MINI_IP/);
  assert.match(inspirationMap, /CursorTuberKit/);
  assert.match(inspirationMap, /Neuro SDK/);
  assert.match(inspirationMap, /AIAvatarStackChan/);
  assert.match(inspirationMap, /Use one main repository first/);
  assert.match(inspirationHtml, /IroHarness Inspiration Map/);
  assert.match(inspirationHtml, /CursorTuberKit/);
  assert.match(inspirationHtml, /Neuro SDK/);
  assert.match(inspirationHtml, /AIAvatarStackChan/);
  assert.match(inspirationHtml, /まずはIroHarness本体1リポジトリ/);
  assert.match(absorptionArchitecture, /observe -> contract -> adapter -> simulator -> core promotion/);
  assert.match(absorptionArchitecture, /Serialized speech playback queue/);
  assert.match(absorptionArchitecture, /Device config schema/);
  assert.match(stackchanFirmware, /AIAvatarStackChan/);
  assert.match(stackchanFirmware, /examples\/stackchan-face-poller/);
  assert.match(stackchanFirmware, /stackchan-realtime-simulator/);
  assert.match(slackStackchan, /\/device\/stackchan\/invoke/);
  assert.match(slackStackchan, /example:stackchan-sim/);
  assert.match(slackStackchan, /STACKCHAN_DEVICE_TOKEN/);
  assert.match(slackStackchan, /IROHARNESS_VIEW_DIR/);
  assert.match(slackStackchanExample, /requireEnv\("SLACK_SIGNING_SECRET"\)/);
  assert.match(slackStackchanExample, /requireEnv\("STACKCHAN_DEVICE_TOKEN"\)/);
  assert.match(slackStackchanExample, /createFileCharacterProfile/);
  assert.match(slackStackchanExample, /IROHARNESS_VIEW_DIR/);
  assert.match(slackStackchanExample, /invalid_device_token/);
  assert.match(slackStackchanExample, /server\.on\("upgrade"/);
  assert.match(slackStackchanExample, /createStackChanRealtimeSessionHandler/);
  assert.match(slackStackchanExample, /StackChan realtime WS/);
  assert.match(slackStackchanExample, /stackchan-mock-stt/);
  assert.match(slackStackchanExample, /stackchan-mock-tts/);
  assert.match(stackchanSimulator, /encodeClientTextFrame/);
  assert.match(stackchanSimulator, /audio\.chunk/);
  assert.match(stackchanSimulator, /interrupt/);
  assert.match(stackchanSimulator, /simulator\.summary/);
  assert.match(stackchanSimulator, /fail-over-budget/);
  assert.match(pkg.scripts["example:stackchan-sim"], /stackchan-realtime-simulator/);
  assert.doesNotMatch(slackStackchanExample, /if \(!signingSecret\)/);
  assert.match(slackCodexExample, /requireEnv\("SLACK_SIGNING_SECRET"\)/);
  assert.doesNotMatch(slackCodexExample, /if \(!signingSecret\)/);
  assert.match(stackchanPoller, /\/config\.json/);
  assert.match(stackchanPoller, /\/device\/stackchan\/invoke/);
  assert.match(stackchanPoller, /x-iroharness-device-token/);
  assert.match(stackchanPoller, /wifi_retry_base_ms/);
  assert.match(stackchanPoller, /http_retry_base_ms/);
  assert.match(stackchanPoller, /nextBackoff/);
  assert.match(stackchanPoller, /nextWifiAttemptMs/);
  assert.match(postgresBackup, /pg_dump/);
  assert.match(postgresBackup, /--table=public\.iroharness_audit_log/);
  assert.match(postgresRestore, /IROHARNESS_RESTORE_CONFIRM/);
  assert.match(postgresRestore, /pg_restore/);
  assert.match(postgresRestore, /truncate table/);
  [
    "Audience identity",
    "IROHARNESS_ADMIN_TOKEN",
    "manage_stream",
    "Issue And PR Hygiene"
  ].forEach((section) => {
    assert.match(privacyGuide, new RegExp(section));
  });
  assert.match(privacyGuide, /`\.env` is ignored/);
  assert.match(privacyGuide, /`\.iroharness\/` is ignored recursively/);
  assert.match(pkg.scripts["example:adapter"], /adapter-skeleton/);
  assert.match(pkg.scripts.check, /examples\/adapter-skeleton\.mjs/);
  assert.match(adapterSkeleton, /createSkeletonMicroHarness/);
  assert.match(adapterSkeleton, /createSkeletonBodyDevice/);
  assert.match(adapterSkeleton, /createSkeletonBrain/);
  [
    "Micro Harness Adapter",
    "Body Or Device Adapter",
    "Brain Adapter",
    "Platform Adapter",
    "Pull Request Checklist",
    "IroHarness owns identity"
  ].forEach((section) => {
    assert.match(adapterGuide, new RegExp(section));
  });
  [
    "Codex app-server",
    "OpenClaw",
    "Hermes",
    "Discord",
    "YouTube Live Chat",
    "OBS WebSocket",
    "M5Stack",
    "Even G2",
    "Live2D",
    "VRM/3D",
    "Audience CLI",
    "npm release workflow"
  ].forEach((capability) => {
    assert.match(matrix, new RegExp(capability));
  });
});

test("adapter skeleton example runs all public adapter contracts", () => {
  const result = spawnSync(process.execPath, ["examples/adapter-skeleton.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const output = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(output.ok, true);
  assert.equal(output.microHarness.status, "completed");
  assert.equal(output.body.eventCount, 3);
  assert.equal(output.body.sentCount, 3);
  assert.equal(output.brain.emotion, "attentive");
});

test("generated app smoke test runs package-consumer checks", () => {
  const result = spawnSync(process.execPath, ["examples/generated-app-smoke-test.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok": true/);
  assert.match(result.stdout, /doctor:production/);
});

test("OSS readiness check validates package publication surface", () => {
  const result = spawnSync(process.execPath, ["examples/oss-readiness-check.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok": true/);
  assert.match(result.stdout, /"package": "iroharness"/);
});

test("brain gateway example documents the generated app HTTP brain contract", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const readme = readFileSync("README.md", "utf8");
  const brains = readFileSync(join("docs", "brains.md"), "utf8");
  const gateway = readFileSync(join("examples", "brain-gateway.mjs"), "utf8");
  const providerGateway = readFileSync(join("examples", "provider-brain-gateway.mjs"), "utf8");

  assert.match(pkg.scripts["example:brain-gateway"], /brain-gateway/);
  assert.match(pkg.scripts["example:provider-brain-gateway"], /provider-brain-gateway/);
  assert.match(pkg.scripts.check, /examples\/brain-gateway\.mjs/);
  assert.match(pkg.scripts.check, /examples\/provider-brain-gateway\.mjs/);
  assert.match(readme, /example:brain-gateway/);
  assert.match(readme, /example:provider-brain-gateway/);
  assert.match(brains, /127\.0\.0\.1:8788/);
  assert.match(brains, /127\.0\.0\.1:8789/);
  assert.match(brains, /OpenAI Responses/);
  assert.match(brains, /Anthropic Messages/);
  assert.match(brains, /OpenAI-compatible/);
  assert.match(gateway, /POST \/voice/);
  assert.match(gateway, /POST \/text/);
  assert.match(gateway, /POST \/deep/);
  assert.match(gateway, /payload\.audience/);
  assert.match(gateway, /export const responseFor/);
  assert.match(providerGateway, /POST \/voice/);
  assert.match(providerGateway, /POST \/text/);
  assert.match(providerGateway, /POST \/deep/);
  assert.match(providerGateway, /OPENAI_API_KEY/);
  assert.match(providerGateway, /ANTHROPIC_API_KEY/);
  assert.match(providerGateway, /chat\/completions/);
  assert.doesNotMatch(gateway, /innerHTML/);
  assert.doesNotMatch(providerGateway, /innerHTML/);
});

test("brain gateway example returns slot-specific replies from macro context", async () => {
  const { responseFor } = await import("../examples/brain-gateway.mjs");
  const response = responseFor({
    slot: "deep",
    payload: {
      model: "deep-demo",
      character: { name: "Iroha" },
      actor: { displayName: "Developer" },
      audience: {
        responseDepth: "deep",
        permissions: ["chat_public", "deep_discussion"]
      },
      input: { text: "設計を詰めたい" },
      route: { kind: "deep" },
      projectOs: { tickets: [{ id: "ticket_1" }] }
    }
  });

  assert.match(response.text, /Iroha\/deep\/deep-demo/);
  assert.match(response.text, /Developer向けのdeep応答/);
  assert.equal(response.emotion, "focused");
  assert.equal(response.debug.route, "deep");
  assert.deepEqual(response.debug.permissions, ["chat_public", "deep_discussion"]);
  assert.equal(response.debug.ticketCount, 1);
});

test("provider brain gateway maps macro context to OpenAI, Claude, and local providers", async () => {
  const {
    callProvider,
    createBrainPrompt,
    createProviderConfig
  } = await import("../examples/provider-brain-gateway.mjs");
  const payload = {
    character: {
      name: "Iroha",
      soul: "Stable macro-harness identity."
    },
    actor: { displayName: "Developer" },
    audience: {
      relationship: "developer",
      responseDepth: "deep",
      permissions: ["chat_public", "deep_discussion"]
    },
    input: { text: "設計を整理して" },
    route: { kind: "deep" },
    projectOs: { tickets: [{ id: "ticket_1" }] }
  };

  const prompt = createBrainPrompt({ slot: "deep", payload });
  assert.match(prompt.system, /Stable macro-harness identity/);
  assert.match(prompt.user, /responseDepth: deep/);

  const openaiConfig = createProviderConfig({
    slot: "deep",
    env: {
      IROHARNESS_DEEP_BRAIN_PROVIDER: "openai",
      IROHARNESS_DEEP_BRAIN_MODEL: "openai-deep",
      OPENAI_API_KEY: "test-openai-key"
    }
  });
  const openaiCalls = [];
  const openai = await callProvider({
    slot: "deep",
    payload,
    config: openaiConfig,
    fetchImpl: async (url, options) => {
      openaiCalls.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return {
        ok: true,
        async text() {
          return JSON.stringify({ output_text: "openai response" });
        }
      };
    }
  });
  assert.equal(openai.text, "openai response");
  assert.match(openaiCalls[0].url, /\/responses$/);
  assert.equal(openaiCalls[0].body.model, "openai-deep");
  assert.match(openaiCalls[0].body.instructions, /Iroha/);

  const anthropicConfig = createProviderConfig({
    slot: "text",
    env: {
      IROHARNESS_TEXT_BRAIN_PROVIDER: "anthropic",
      IROHARNESS_TEXT_BRAIN_MODEL: "claude-text",
      ANTHROPIC_API_KEY: "test-anthropic-key"
    }
  });
  const anthropicCalls = [];
  const anthropic = await callProvider({
    slot: "text",
    payload,
    config: anthropicConfig,
    fetchImpl: async (url, options) => {
      anthropicCalls.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return {
        ok: true,
        async text() {
          return JSON.stringify({ content: [{ type: "text", text: "claude response" }] });
        }
      };
    }
  });
  assert.equal(anthropic.text, "claude response");
  assert.match(anthropicCalls[0].url, /\/messages$/);
  assert.equal(anthropicCalls[0].body.model, "claude-text");
  assert.equal(anthropicCalls[0].headers["anthropic-version"], "2023-06-01");

  const localConfig = createProviderConfig({
    slot: "voice",
    env: {
      IROHARNESS_VOICE_BRAIN_PROVIDER: "openai-compatible",
      IROHARNESS_VOICE_BRAIN_MODEL: "local-fast",
      LOCAL_OPENAI_BASE_URL: "http://127.0.0.1:11434/v1"
    }
  });
  const localCalls = [];
  const local = await callProvider({
    slot: "voice",
    payload,
    config: localConfig,
    fetchImpl: async (url, options) => {
      localCalls.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return {
        ok: true,
        async text() {
          return JSON.stringify({ choices: [{ message: { content: "local response" } }] });
        }
      };
    }
  });
  assert.equal(local.text, "local response");
  assert.match(localCalls[0].url, /\/chat\/completions$/);
  assert.equal(localCalls[0].body.model, "local-fast");
  assert.equal(localCalls[0].body.messages[0].role, "system");
});

test("package exposes TypeScript declarations for public entrypoints", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(pkg.types, "src/index.d.ts");
  assert.equal(pkg.exports["."].types, "./src/index.d.ts");
  assert.equal(pkg.exports["./adapters"].types, "./src/adapters/index.d.ts");
  assert.equal(pkg.exports["./testing"].types, "./src/testing/index.d.ts");

  [
    "src/index.d.ts",
    join("src", "adapters", "index.d.ts"),
    join("src", "testing", "index.d.ts")
  ].forEach((file) => {
    const content = readFileSync(file, "utf8");
    assert.doesNotMatch(content, /\bany\b/);
    assert.doesNotMatch(content, /\bunknown\b/);
    assert.match(content, /export /);
  });
});

test("browser demo includes audience admin UI for stream and fan operations", () => {
  const html = readFileSync(join("examples", "browser-avatar", "index.html"), "utf8");
  const app = readFileSync(join("examples", "browser-avatar", "app.js"), "utf8");
  const server = readFileSync("examples/browser-server.mjs", "utf8");
  const screenshotCheck = readFileSync(join("examples", "browser-screenshot-check.mjs"), "utf8");
  const envExample = readFileSync(".env.example", "utf8");

  [
    "admin-token-form",
    "user-form",
    "identity-form",
    "resolve-form",
    "permission-form",
    "permission-expires-at",
    "stream-form",
    "audience-table"
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(app, /\/audience\/resolve/);
  assert.match(app, /\/audience\/users/);
  assert.match(app, /method: "DELETE"/);
  assert.match(app, /permissionOverrides/);
  assert.match(app, /\/audience\/stream-sessions/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.match(server, /userRegistry,/);
  assert.match(server, /IROHARNESS_ADMIN_TOKEN/);
  assert.match(server, /createHttpBrain/);
  assert.match(server, /IROHARNESS_VOICE_BRAIN_ENDPOINT/);
  assert.match(server, /IROHARNESS_DEEP_BRAIN_ENDPOINT/);
  assert.match(server, /\?view=admin/);
  assert.match(screenshotCheck, /playwright/);
  assert.match(screenshotCheck, /name: "chat"/);
  assert.match(screenshotCheck, /name: "overlay"/);
  assert.match(screenshotCheck, /name: "admin"/);
  assert.match(screenshotCheck, /IROHARNESS_E2E_URL/);
  assert.match(screenshotCheck, /Overlay view should hide the control panel/);
  assert.match(envExample, /IROHARNESS_VOICE_BRAIN_ENDPOINT=/);
  assert.match(envExample, /IROHARNESS_TEXT_BRAIN_MODEL=/);
  assert.match(envExample, /IROHARNESS_DEEP_BRAIN_ENDPOINT=/);
});

test("OpenAPI document covers dev server and audience management routes", () => {
  const openapi = JSON.parse(readFileSync(join("protocols", "openapi.json"), "utf8"));

  assert.equal(openapi.openapi, "3.1.0");
  [
    "/openapi.json",
    "/health",
    "/events",
    "/state",
    "/pjos",
    "/turn",
    "/platforms",
    "/platform/{platform}/message",
    "/bodies",
    "/body/{id}",
    "/body/{id}/events",
    "/audience",
    "/audience/resolve",
    "/audience/users",
    "/audience/users/{userId}",
    "/audience/users/{userId}/identities",
    "/audience/users/{userId}/permissions",
    "/audience/stream-sessions",
    "/audience/stream-sessions/{sessionId}"
  ].forEach((path) => {
    assert.equal(Boolean(openapi.paths[path]), true, path);
  });
  assert.equal(openapi.components.securitySchemes.adminToken.type, "http");
  assert.equal(
    openapi.paths["/health"].get.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/HealthStatus"
  );
  assert.equal(
    openapi.components.schemas.HealthStatus.properties.service.required.includes("version"),
    true
  );
  assert.equal(openapi.components.schemas.HealthStatus.required.includes("brains"), true);
  assert.equal(
    openapi.components.schemas.HealthStatus.properties.brains.items.required.includes("slot"),
    true
  );
  assert.equal(
    openapi.components.schemas.HealthStatus.properties.runtimes.items.required.includes("state"),
    true
  );
  assert.equal(
    Boolean(openapi.components.schemas.HealthStatus.properties.runtimes.items.properties.lastError),
    true
  );
  assert.equal(
    openapi.paths["/audience/resolve"].get.responses["200"].content["application/json"].schema
      .$ref,
    "#/components/schemas/AudienceResolution"
  );
  assert.equal(
    openapi.paths["/audience/users/{userId}/permissions"].post.requestBody.content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/PermissionOverrideWrite"
  );
  assert.equal(
    openapi.paths["/audience/users/{userId}/permissions"].delete.parameters.some(
      (parameter) => parameter.name === "permission" && parameter.required
    ),
    true
  );
  assert.deepEqual(
    openapi.components.schemas.AudienceSnapshot.required,
    ["users", "userIdentities", "permissionOverrides", "streamSessions", "auditLog"]
  );
});

test("audience admin client example follows the OpenAPI audience routes", () => {
  const example = readFileSync(join("examples", "audience-admin-client.mjs"), "utf8");

  [
    "/audience/users",
    "/audience/users/developer_demo/identities",
    "/audience/users/developer_demo/permissions",
    "/audience/stream-sessions",
    "/audience/resolve",
    "/audience"
  ].forEach((route) => {
    assert.match(example, new RegExp(route.replace(/[{}]/g, "\\$&")));
  });
  assert.match(example, /IROHARNESS_URL/);
  assert.match(example, /IROHARNESS_ADMIN_TOKEN/);
  assert.match(example, /manage_stream/);
  assert.match(example, /stream:youtube/);
});
