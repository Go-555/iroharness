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

test("user registry can link new platform identities without changing the user", () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "dev_1",
    displayName: "Developer",
    role: "developer",
    identities: { discord: "discord-dev" }
  });

  registry.linkIdentity({
    userId: "dev_1",
    platform: "youtube",
    platformUserId: "UCDEV",
    displayName: "Dev Channel"
  });

  const fromDiscord = registry.resolveActor({
    platform: "discord",
    platformUserId: "discord-dev"
  });
  const fromYoutube = registry.resolveActor({
    platform: "youtube",
    platformUserId: "UCDEV"
  });

  assert.equal(fromDiscord.user.id, "dev_1");
  assert.equal(fromYoutube.user.id, "dev_1");
  assert.equal(fromYoutube.identity.displayName, "Dev Channel");
  assert.equal(registry.snapshot().userIdentities.length, 2);
});

test("permission overrides can grant a member stream management without changing role", () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "member_1",
    displayName: "Trusted Member",
    role: "member",
    identities: { youtube: "UCMEMBER" }
  });
  registry.setPermissionOverride({
    userId: "member_1",
    permission: "manage_stream",
    effect: "allow",
    reason: "trusted stream helper"
  });

  const actor = registry.resolveActor({
    platform: "youtube",
    platformUserId: "UCMEMBER"
  });

  assert.equal(actor.user.role, "member");
  assert.equal(actor.user.permissionOverrides.length, 1);
  assert.equal(actor.user.permissionOverrides[0].permission, "manage_stream");
});

test("file user registry persists stream sessions and permission overrides", () => {
  const path = join(mkdtempSync(join(tmpdir(), "iroharness-users-")), "users.json");
  const first = createFileUserRegistry({ path });
  first.registerUser({
    id: "owner_1",
    displayName: "Owner",
    role: "owner",
    identities: { youtube: "UCOWNER" }
  });
  first.setPermissionOverride({
    userId: "owner_1",
    permission: "delegate_work",
    effect: "deny",
    scope: "stream:youtube"
  });
  first.createStreamSession({
    id: "stream_1",
    platform: "youtube",
    platformChannelId: "live-chat-1",
    title: "IroHarness Dev Stream",
    hostUserId: "owner_1"
  });

  const second = createFileUserRegistry({ path });
  const snapshot = second.snapshot();

  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.permissionOverrides.length, 1);
  assert.equal(snapshot.streamSessions.length, 1);
  assert.equal(snapshot.streamSessions[0].status, "live");
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

test("permission overrides can grant delegate work for a specific trusted fan", async () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "fan_operator",
    displayName: "Fan Operator",
    role: "fan",
    identities: { discord: "fan-operator" }
  });
  registry.setPermissionOverride({
    userId: "fan_operator",
    permission: "delegate_work",
    effect: "allow",
    reason: "temporary stream operator"
  });
  const harness = createBaseHarness({ userRegistry: registry });

  const result = await harness.receive({
    source: "discord",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "discord",
      platformUserId: "fan-operator",
      displayName: "Fan Operator"
    }
  });

  assert.equal(result.kind, "delegation");
  assert.equal(result.actor.user.role, "fan");
  assert.equal(harness.projectOs().tickets.length, 1);
});

test("scoped permission overrides apply only to matching platform context", async () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "owner_1",
    displayName: "Owner",
    role: "owner",
    identities: {
      discord: "owner-discord",
      youtube: "owner-youtube"
    }
  });
  registry.setPermissionOverride({
    userId: "owner_1",
    permission: "delegate_work",
    effect: "deny",
    scope: "stream:youtube",
    reason: "no work delegation during public stream"
  });
  const harness = createBaseHarness({ userRegistry: registry });

  const discordResult = await harness.receive({
    source: "discord",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "discord",
      platformUserId: "owner-discord",
      displayName: "Owner"
    }
  });
  const youtubeResult = await harness.receive({
    source: "youtube",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "youtube",
      platformUserId: "owner-youtube",
      displayName: "Owner"
    }
  });

  assert.equal(discordResult.kind, "delegation");
  assert.equal(youtubeResult.kind, "permission_denied");
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
