import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createEchoBrain,
  createFileUserRegistry,
  createHeuristicRouter,
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createRecorderDevice,
  createStubMicroHarness
} from "../src/index.js";

const createBaseHarness = ({ userRegistry }) =>
  createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Same personality across channels.",
      voiceStyle: "short"
    },
    projectOs: createInMemoryProjectOs(),
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createEchoBrain("voice-fast"),
      text: createEchoBrain("text-deep")
    },
    devices: [createRecorderDevice("recorder")],
    microHarnesses: [createStubMicroHarness("codex", ["code"])]
  });

test("user registry links Discord and YouTube identities to one person", () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "user_keita",
    displayName: "Keita",
    role: "developer",
    identities: {
      discord: "D123",
      youtube: "UC123"
    }
  });

  assert.equal(
    registry.resolveActor({ platform: "discord", platformUserId: "D123" }).user.id,
    "user_keita"
  );
  assert.equal(
    registry.resolveActor({ platform: "youtube", platformUserId: "UC123" }).user.id,
    "user_keita"
  );
});

test("file user registry persists audience identity mappings", () => {
  const path = join(mkdtempSync(join(tmpdir(), "iroharness-users-")), "users.json");
  const first = createFileUserRegistry({ path });
  first.registerUser({
    id: "fan_1",
    displayName: "Fan One",
    role: "fan",
    identities: { discord: "fan-discord" }
  });

  const raw = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(raw.users.length, 1);

  const second = createFileUserRegistry({ path });
  assert.equal(
    second.resolveActor({ platform: "discord", platformUserId: "fan-discord" }).user.id,
    "fan_1"
  );
});

test("fans can chat but cannot delegate work to micro harnesses", async () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "fan_1",
    displayName: "Fan One",
    role: "fan",
    identities: { discord: "fan-discord" }
  });
  const harness = createBaseHarness({ userRegistry: registry });

  const chat = await harness.receive({
    source: "discord",
    modality: "text",
    text: "こんにちは",
    actor: {
      platform: "discord",
      platformUserId: "fan-discord",
      displayName: "Fan One"
    }
  });
  assert.equal(chat.kind, "response");

  const denied = await harness.receive({
    source: "discord",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "discord",
      platformUserId: "fan-discord",
      displayName: "Fan One"
    }
  });
  assert.equal(denied.kind, "permission_denied");
  assert.equal(harness.projectOs().tickets.length, 0);
});

test("developers can have deep discussion and delegate work", async () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "dev_1",
    displayName: "Developer",
    role: "developer",
    identities: { discord: "dev-discord" }
  });
  const harness = createBaseHarness({ userRegistry: registry });

  const result = await harness.receive({
    source: "discord",
    modality: "text",
    text: "Codexでアーキテクチャ設計をレビューして",
    actor: {
      platform: "discord",
      platformUserId: "dev-discord",
      displayName: "Developer"
    }
  });

  assert.equal(result.kind, "delegation");
  assert.equal(result.actor.user.id, "dev_1");
  assert.equal(harness.projectOs().tickets.length, 1);
  assert.equal(harness.projectOs().tickets[0].metadata.actorRole, "developer");
});
