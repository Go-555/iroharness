// Phase 5b (5.3), path 1: the createIroHarness work route (the original
// micro-harness delegation entry) honors the view's work-runner-policy.json
// through the SAME shared gate as every other delegate path.
//
// Wiring: createIroHarness({ workRunnerPolicy }) is optional and additive —
// without it the behavior is exactly the pre-5.3 one (permission policy
// only). With it, the zone table of the exported policy is enforced on top:
// public views can never delegate (even with delegate_work), trusted views
// require the delegate_work permission (granted via role or permission
// override), owner views delegate as before.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createEchoBrain,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createStubMicroHarness,
} from "../src/index.js";

const ZONES = ["public", "trusted", "owner"];

const runCli = (args) =>
  spawnSync(
    process.execPath,
    [join(process.cwd(), "bin", "iroharness.mjs"), ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );

// The authority: the real policies written by the real `view export`.
const policies = (() => {
  const dir = mkdtempSync(join(tmpdir(), "wr-harness-"));
  const appDir = join(dir, "companion");
  const init = runCli(["init", appDir, "--character", "Iroha"]);
  if (init.status !== 0) {
    throw new Error(`iroharness init failed: ${init.stderr}`);
  }
  const byZone = {};
  for (const zone of ZONES) {
    const out = join(dir, `${zone}-view`);
    const result = runCli([
      "view",
      "export",
      appDir,
      "--zone",
      zone,
      "--out",
      out,
      "--force",
      "--json",
    ]);
    if (result.status !== 0) {
      throw new Error(`view export (${zone}) failed: ${result.stderr}`);
    }
    byZone[zone] = JSON.parse(
      readFileSync(join(out, "current", "work-runner-policy.json"), "utf8"),
    );
  }
  return byZone;
})();

const makeHarness = ({ workRunnerPolicy } = {}) => {
  const projectOs = createInMemoryProjectOs();
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "developer",
    displayName: "Developer",
    role: "developer", // role grants delegate_work
    identities: { slack: "UDEV" },
  });
  userRegistry.registerUser({
    id: "fan",
    displayName: "Fan",
    role: "fan", // chat_public only
    identities: { slack: "UFAN" },
  });
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "soul",
      voiceStyle: "short",
    },
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createEchoBrain("voice-fast"),
      text: createEchoBrain("text-deep"),
    },
    microHarnesses: [createStubMicroHarness("codex", ["code"])],
    ...(workRunnerPolicy === undefined ? {} : { workRunnerPolicy }),
  });
  return { harness, projectOs, userRegistry };
};

const sendWork = (harness, platformUserId) =>
  harness.receive({
    source: "slack",
    modality: "text",
    text: "Codexでこのコードをレビューして",
    actor: { platform: "slack", platformUserId, displayName: "Someone" },
  });

test("work route matrix: zone x actor over the real exported policies", async () => {
  const matrix = [
    // [zone, platformUserId, expected kind]
    ["public", "UDEV", "permission_denied"], // public: denied even with delegate_work
    ["public", "UFAN", "permission_denied"],
    ["trusted", "UFAN", "permission_denied"], // trusted: permission-required
    ["trusted", "UDEV", "delegation"],
    ["owner", "UDEV", "delegation"],
  ];
  for (const [zone, platformUserId, kind] of matrix) {
    const { harness } = makeHarness({ workRunnerPolicy: policies[zone] });
    const result = await sendWork(harness, platformUserId);
    assert.equal(result.kind, kind, `${zone}/${platformUserId}`);
    const tickets = harness.projectOs().tickets;
    if (kind === "permission_denied") {
      assert.equal(tickets.length, 0, `${zone}: no ticket may be created`);
    } else {
      assert.equal(tickets.length, 1, `${zone}: the delegation ran`);
      assert.equal(tickets[0].executorHarnessId, "codex");
    }
  }
});

test("public zone reports the view denial, not a missing user permission", async () => {
  const { harness } = makeHarness({ workRunnerPolicy: policies.public });
  const result = await sendWork(harness, "UDEV");
  assert.equal(result.kind, "permission_denied");
  assert.equal(result.permission.permission, "delegate_work");
  assert.match(result.permission.reason, /denied for this view/);
});

test("trusted zone honors a delegate_work permission override (the existing grant path)", async () => {
  const { harness, userRegistry } = makeHarness({
    workRunnerPolicy: policies.trusted,
  });
  // fan has no delegate_work; the standard override machinery grants it
  userRegistry.setPermissionOverride({
    userId: "fan",
    permission: "delegate_work",
    effect: "allow",
  });
  const granted = await sendWork(harness, "UFAN");
  assert.equal(granted.kind, "delegation");

  // and a deny override revokes it again — same machinery, same gate
  userRegistry.setPermissionOverride({
    userId: "fan",
    permission: "delegate_work",
    effect: "deny",
  });
  const revoked = await sendWork(harness, "UFAN");
  assert.equal(revoked.kind, "permission_denied");
});

test("without workRunnerPolicy the pre-5.3 behavior is unchanged (additive only)", async () => {
  const { harness } = makeHarness();
  const result = await sendWork(harness, "UDEV");
  assert.equal(result.kind, "delegation");
  const denied = await sendWork(harness, "UFAN");
  assert.equal(denied.kind, "permission_denied");
});

test("a tainted workRunnerPolicy is refused at construction (fail-closed)", async () => {
  assert.throws(
    () => makeHarness({ workRunnerPolicy: { kind: "bogus" } }),
    /iroharness\.workRunnerPolicy/,
  );
  // a well-kinded policy with missing/unknown delegation vocabulary
  // constructs, but the shared gate fails closed on every work turn
  const { harness } = makeHarness({
    workRunnerPolicy: { kind: "iroharness.workRunnerPolicy" },
  });
  const result = await sendWork(harness, "UDEV");
  assert.equal(result.kind, "permission_denied");
});
