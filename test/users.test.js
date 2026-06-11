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
  createPostgresUserRegistry,
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
      text: createEchoBrain("text-standard")
    },
    devices: [createRecorderDevice("recorder")],
    microHarnesses: [createStubMicroHarness("codex", ["code"])]
  });

const createFakePostgresAudienceQuery = () => {
  let users = [];
  let identities = [];
  let overrides = [];
  let streams = [];
  let auditLog = [];
  const timestamp = "2026-05-25T00:00:00.000Z";

  const touch = (row) => ({
    ...row,
    created_at: row.created_at || timestamp,
    updated_at: timestamp
  });

  const query = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("insert into iroharness_users")) {
      const [id, display_name, role, relationship, permissions, metadata] = params;
      const row = touch({ id, display_name, role, relationship, permissions, metadata });
      users = [...users.filter((candidate) => candidate.id !== id), row];
      return { rows: [row] };
    }

    if (normalized.startsWith("insert into iroharness_audit_log")) {
      const [id, action, resource_type, resource_id, user_id, metadata] = params;
      const row = {
        id,
        action,
        resource_type,
        resource_id,
        user_id,
        metadata,
        created_at: timestamp
      };
      auditLog = [...auditLog, row];
      return { rows: [row] };
    }

    if (normalized.startsWith("update iroharness_users")) {
      const [id, display_name, role, relationship, permissions, metadata] = params;
      users = users.map((candidate) =>
        candidate.id === id
          ? touch({ ...candidate, display_name, role, relationship, permissions, metadata })
          : candidate
      );
      return { rows: users.filter((candidate) => candidate.id === id) };
    }

    if (normalized.startsWith("delete from iroharness_user_identities")) {
      const [userId] = params;
      identities = identities.filter((identity) => identity.user_id !== userId);
      return { rows: [] };
    }

    if (normalized.startsWith("insert into iroharness_user_identities")) {
      const [id, user_id, platform, platform_user_id, display_name, metadata] = params;
      const row = touch({ id, user_id, platform, platform_user_id, display_name, metadata });
      identities = [
        ...identities.filter(
          (identity) =>
            !(identity.platform === platform && identity.platform_user_id === platform_user_id)
        ),
        row
      ];
      return { rows: [row] };
    }

    if (
      normalized.startsWith("select * from iroharness_user_identities where platform = $1")
    ) {
      const [platform, platformUserId] = params;
      return {
        rows: identities.filter(
          (identity) =>
            identity.platform === platform && identity.platform_user_id === platformUserId
        )
      };
    }

    if (
      normalized.startsWith("select * from iroharness_user_identities where user_id = $1")
    ) {
      const [userId] = params;
      return { rows: identities.filter((identity) => identity.user_id === userId) };
    }

    if (normalized.startsWith("insert into iroharness_permission_overrides")) {
      const [id, user_id, permission, effect, scope, reason, expires_at, metadata] = params;
      const row = touch({
        id,
        user_id,
        permission,
        effect,
        scope,
        reason,
        expires_at,
        metadata
      });
      overrides = [
        ...overrides.filter(
          (override) =>
            !(
              override.user_id === user_id &&
              override.permission === permission &&
              override.scope === scope
            )
        ),
        row
      ];
      return { rows: [row] };
    }

    if (normalized.startsWith("delete from iroharness_permission_overrides")) {
      const [userId, permission, scope] = params;
      const deleted = overrides.filter(
        (override) =>
          override.user_id === userId &&
          override.permission === permission &&
          override.scope === scope
      );
      overrides = overrides.filter(
        (override) =>
          !(
            override.user_id === userId &&
            override.permission === permission &&
            override.scope === scope
          )
      );
      return { rows: deleted };
    }

    if (
      normalized.startsWith("select * from iroharness_permission_overrides where user_id = $1")
    ) {
      const [userId] = params;
      return { rows: overrides.filter((override) => override.user_id === userId) };
    }

    if (normalized.startsWith("insert into iroharness_stream_sessions")) {
      const [id, platform, platform_channel_id, title, host_user_id, status, metadata] = params;
      const row = touch({
        id,
        platform,
        platform_channel_id,
        title,
        host_user_id,
        status,
        metadata,
        started_at: timestamp,
        ended_at: null
      });
      streams = [...streams.filter((session) => session.id !== id), row];
      return { rows: [row] };
    }

    if (normalized.startsWith("update iroharness_stream_sessions")) {
      const [id, title, host_user_id, status, metadata, ended_at] = params;
      streams = streams.map((session) =>
        session.id === id
          ? touch({ ...session, title, host_user_id, status, metadata, ended_at })
          : session
      );
      return { rows: streams.filter((session) => session.id === id) };
    }

    if (normalized.startsWith("select * from iroharness_stream_sessions where id = $1")) {
      const [id] = params;
      return { rows: streams.filter((session) => session.id === id) };
    }

    if (normalized.startsWith("select * from iroharness_users where id = $1")) {
      const [id] = params;
      return { rows: users.filter((user) => user.id === id) };
    }

    if (normalized.startsWith("select * from iroharness_users order by")) {
      return { rows: users };
    }

    if (normalized.startsWith("select * from iroharness_user_identities order by")) {
      return { rows: identities };
    }

    if (normalized.startsWith("select * from iroharness_permission_overrides order by")) {
      return { rows: overrides };
    }

    if (normalized.startsWith("select * from iroharness_stream_sessions order by")) {
      return { rows: streams };
    }

    if (normalized.startsWith("select * from iroharness_audit_log order by")) {
      return { rows: auditLog };
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  };

  return query;
};

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

test("permission overrides can be revoked from the file registry", () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "member_1",
    displayName: "Member",
    role: "member",
    identities: { discord: "member-discord" }
  });
  registry.setPermissionOverride({
    userId: "member_1",
    permission: "manage_stream",
    effect: "allow",
    scope: "stream:youtube"
  });
  const deleted = registry.deletePermissionOverride({
    userId: "member_1",
    permission: "manage_stream",
    scope: "stream:youtube"
  });

  assert.equal(deleted.deleted, true);
  const snapshot = registry.snapshot();
  assert.equal(snapshot.permissionOverrides.length, 0);
  assert.equal(
    snapshot.auditLog.some((entry) => entry.action === "audience.permission.delete"),
    true
  );
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
  assert.equal(snapshot.auditLog.length, 3);
  assert.deepEqual(
    snapshot.auditLog.map((entry) => entry.action),
    ["audience.user.register", "audience.permission.set", "audience.stream.create"]
  );
});

test("Postgres user registry resolves linked platform identities and scoped permissions", async () => {
  const registry = createPostgresUserRegistry({
    query: createFakePostgresAudienceQuery()
  });

  await registry.registerUser({
    id: "dev_1",
    displayName: "Developer",
    role: "developer",
    identities: {
      discord: "discord-dev"
    },
    relationship: "developer"
  });
  await registry.linkIdentity({
    userId: "dev_1",
    platform: "youtube",
    platformUserId: "UCDEV",
    displayName: "Dev Channel"
  });
  await registry.setPermissionOverride({
    userId: "dev_1",
    permission: "manage_stream",
    effect: "allow",
    scope: "stream:youtube"
  });
  await registry.createStreamSession({
    id: "stream_1",
    platform: "youtube",
    platformChannelId: "live-chat-1",
    title: "IroHarness Dev Stream",
    hostUserId: "dev_1"
  });
  await registry.updateStreamSession("stream_1", {
    status: "paused",
    metadata: { reason: "break" }
  });

  const discordActor = await registry.resolveActor({
    platform: "discord",
    platformUserId: "discord-dev",
    displayName: "Developer"
  });
  const youtubeActor = await registry.resolveActor({
    platform: "youtube",
    platformUserId: "UCDEV",
    displayName: "Dev Channel"
  });
  const snapshot = await registry.snapshot();

  assert.equal(discordActor.user.id, "dev_1");
  assert.equal(youtubeActor.user.id, "dev_1");
  assert.equal(youtubeActor.identity.displayName, "Dev Channel");
  assert.equal(youtubeActor.user.permissionOverrides[0].permission, "manage_stream");
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.userIdentities.length, 2);
  assert.equal(snapshot.streamSessions[0].status, "paused");
  assert.equal(snapshot.streamSessions[0].metadata.reason, "break");
  assert.deepEqual(
    snapshot.auditLog.map((entry) => entry.action),
    [
      "audience.user.register",
      "audience.identity.link",
      "audience.permission.set",
      "audience.stream.create",
      "audience.stream.update"
    ]
  );
});

test("Postgres user registry can revoke scoped permission overrides", async () => {
  const query = createFakePostgresAudienceQuery();
  const registry = createPostgresUserRegistry({ query });
  await registry.registerUser({
    id: "dev_1",
    displayName: "Developer",
    role: "developer"
  });
  await registry.setPermissionOverride({
    userId: "dev_1",
    permission: "manage_stream",
    effect: "allow",
    scope: "stream:youtube"
  });
  const deleted = await registry.deletePermissionOverride({
    userId: "dev_1",
    permission: "manage_stream",
    scope: "stream:youtube"
  });
  const snapshot = await registry.snapshot();

  assert.equal(deleted.deleted, true);
  assert.equal(snapshot.permissionOverrides.length, 0);
  assert.equal(
    snapshot.auditLog.some((entry) => entry.action === "audience.permission.delete"),
    true
  );
});

test("IroHarness can use an async Postgres user registry for developer delegation", async () => {
  const registry = createPostgresUserRegistry({
    query: createFakePostgresAudienceQuery()
  });
  await registry.registerUser({
    id: "dev_1",
    displayName: "Developer",
    role: "developer",
    identities: { discord: "discord-dev" }
  });
  const harness = createBaseHarness({ userRegistry: registry });

  const result = await harness.receive({
    source: "discord",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "discord",
      platformUserId: "discord-dev",
      displayName: "Developer"
    }
  });

  assert.equal(result.kind, "delegation");
  assert.equal(result.actor.user.id, "dev_1");
  assert.equal(harness.projectOs().tickets[0].metadata.actorRole, "developer");
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

test("expired permission overrides do not grant privileged work", async () => {
  const registry = createInMemoryUserRegistry();
  registry.registerUser({
    id: "fan_operator",
    displayName: "Fan Operator",
    role: "fan",
    identities: { discord: "expired-fan-operator" }
  });
  registry.setPermissionOverride({
    userId: "fan_operator",
    permission: "delegate_work",
    effect: "allow",
    expiresAt: "2000-01-01T00:00:00.000Z",
    reason: "expired operator window"
  });
  const harness = createBaseHarness({ userRegistry: registry });

  const result = await harness.receive({
    source: "discord",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "discord",
      platformUserId: "expired-fan-operator",
      displayName: "Fan Operator"
    }
  });

  assert.equal(result.kind, "permission_denied");
  assert.equal(harness.projectOs().tickets.length, 0);
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
