import {
  createInMemoryProjectOs,
  createInMemoryUserRegistry,
  createIroHarness,
  createEchoBrain,
  createHeuristicRouter,
  createStubMicroHarness
} from "../src/index.js";

const userRegistry = createInMemoryUserRegistry();

userRegistry.registerUser({
  id: "user_keita",
  displayName: "Keita",
  role: "developer",
  identities: {
    discord: "discord-keita"
  }
});

userRegistry.linkIdentity({
  userId: "user_keita",
  platform: "youtube",
  platformUserId: "UCkeita",
  displayName: "Keita Channel"
});

userRegistry.registerUser({
  id: "fan_operator",
  displayName: "Fan Operator",
  role: "fan",
  identities: {
    discord: "discord-helper"
  }
});

userRegistry.setPermissionOverride({
  userId: "fan_operator",
  permission: "delegate_work",
  effect: "allow",
  reason: "temporary stream operator"
});

userRegistry.createStreamSession({
  id: "youtube_stream_1",
  platform: "youtube",
  platformChannelId: "live-chat-1",
  title: "IroHarness Dev Stream",
  hostUserId: "user_keita"
});

const harness = createIroHarness({
  character: {
    id: "iroha",
    name: "Iroha",
    soul: "Same character across YouTube, Discord, and developer tools.",
    voiceStyle: "short"
  },
  projectOs: createInMemoryProjectOs(),
  userRegistry,
  router: createHeuristicRouter(),
  brains: {
    voice: createEchoBrain("voice-fast"),
    text: createEchoBrain("text-standard")
  },
  microHarnesses: [createStubMicroHarness("codex", ["code", "review"])]
});

const turns = [
  {
    source: "youtube",
    modality: "text",
    text: "こんにちは",
    actor: {
      platform: "youtube",
      platformUserId: "UCkeita",
      displayName: "Keita Channel"
    }
  },
  {
    source: "discord",
    modality: "text",
    text: "Codexでコードをレビューして",
    actor: {
      platform: "discord",
      platformUserId: "discord-helper",
      displayName: "Fan Operator"
    }
  }
];

for (const turn of turns) {
  const result = await harness.receive(turn);
  console.log(
    JSON.stringify({
      source: turn.source,
      userId: result.actor.user.id,
      role: result.actor.user.role,
      kind: result.kind,
      route: result.route.kind
    })
  );
}

console.log(
  JSON.stringify({
    users: harness.users().users.length,
    identities: harness.users().userIdentities.length,
    overrides: harness.users().permissionOverrides.length,
    streamSessions: harness.users().streamSessions.length
  })
);
