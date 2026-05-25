import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODES = Object.freeze({
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  working: "working",
  error: "error"
});

const DEFAULT_EMOTION = "neutral";

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

const freezeCopy = (value) => Object.freeze({ ...value });

const createProjectOsStore = (initialState = {}, persist = () => {}) => {
  let tickets = Object.freeze([...(initialState.tickets || [])]);
  let runs = Object.freeze([...(initialState.runs || [])]);
  let artifacts = Object.freeze([...(initialState.artifacts || [])]);

  const rawSnapshot = () => ({
    tickets: [...tickets],
    runs: [...runs],
    artifacts: [...artifacts]
  });

  const save = () => persist(rawSnapshot());

  const createTicket = ({
    title,
    purpose,
    acceptance = [],
    ownerCharacterId,
    executorHarnessId = null,
    metadata = {}
  }) => {
    const ticket = freezeCopy({
      id: createId("ticket"),
      title,
      purpose,
      acceptance: Object.freeze([...acceptance]),
      ownerCharacterId,
      executorHarnessId,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      metadata: freezeCopy(metadata)
    });
    tickets = Object.freeze([...tickets, ticket]);
    save();
    return ticket;
  };

  const updateTicket = (ticketId, patch) => {
    let nextTicket = null;
    tickets = Object.freeze(
      tickets.map((ticket) => {
        if (ticket.id !== ticketId) {
          return ticket;
        }
        nextTicket = freezeCopy({
          ...ticket,
          ...patch,
          updatedAt: nowIso()
        });
        return nextTicket;
      })
    );
    if (!nextTicket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }
    save();
    return nextTicket;
  };

  const createRun = ({ ticketId, harnessId, input }) => {
    const run = freezeCopy({
      id: createId("run"),
      ticketId,
      harnessId,
      status: "running",
      input,
      output: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    runs = Object.freeze([...runs, run]);
    save();
    return run;
  };

  const completeRun = (runId, output, status = "completed") => {
    let nextRun = null;
    runs = Object.freeze(
      runs.map((run) => {
        if (run.id !== runId) {
          return run;
        }
        nextRun = freezeCopy({
          ...run,
          status,
          output,
          updatedAt: nowIso()
        });
        return nextRun;
      })
    );
    if (!nextRun) {
      throw new Error(`Run not found: ${runId}`);
    }
    save();
    return nextRun;
  };

  const addArtifact = ({ ticketId, runId, kind, uri, title }) => {
    const artifact = freezeCopy({
      id: createId("artifact"),
      ticketId,
      runId,
      kind,
      uri,
      title,
      createdAt: nowIso()
    });
    artifacts = Object.freeze([...artifacts, artifact]);
    save();
    return artifact;
  };

  const snapshot = () =>
    freezeCopy({
      tickets: Object.freeze([...tickets]),
      runs: Object.freeze([...runs]),
      artifacts: Object.freeze([...artifacts])
    });

  return Object.freeze({
    createTicket,
    updateTicket,
    createRun,
    completeRun,
    addArtifact,
    snapshot
  });
};

const createIdentityRows = (userId, identities = {}, createdAt = nowIso()) =>
  Object.freeze(
    Object.entries(identities).map(([platform, platformUserId]) =>
      freezeCopy({
        id: createId("identity"),
        userId,
        platform,
        platformUserId: String(platformUserId),
        displayName: null,
        metadata: freezeCopy({}),
        createdAt,
        updatedAt: createdAt
      })
    )
  );

const createIdentitiesObject = (identityRows, userId) =>
  freezeCopy(
    identityRows
      .filter((identity) => identity.userId === userId)
      .reduce(
        (identities, identity) => ({
          ...identities,
          [identity.platform]: identity.platformUserId
        }),
        {}
      )
  );

const createUserRegistryStore = (initialState = {}, persist = () => {}) => {
  let users = Object.freeze([...(initialState.users || [])]);
  let userIdentities = Object.freeze(
    initialState.userIdentities
      ? [...initialState.userIdentities]
      : users.flatMap((user) => createIdentityRows(user.id, user.identities || {}))
  );
  let permissionOverrides = Object.freeze([...(initialState.permissionOverrides || [])]);
  let streamSessions = Object.freeze([...(initialState.streamSessions || [])]);

  const hydrateUser = (user) =>
    freezeCopy({
      ...user,
      identities: createIdentitiesObject(userIdentities, user.id),
      permissions: Object.freeze([...(user.permissions || [])]),
      metadata: freezeCopy(user.metadata || {}),
      permissionOverrides: Object.freeze(
        permissionOverrides.filter((override) => override.userId === user.id)
      )
    });

  const save = () =>
    persist({
      users: [...users],
      userIdentities: [...userIdentities],
      permissionOverrides: [...permissionOverrides],
      streamSessions: [...streamSessions]
    });

  const registerUser = ({
    id = createId("user"),
    displayName,
    role = "fan",
    identities = {},
    permissions = [],
    relationship = "public",
    metadata = {}
  }) => {
    const timestamp = nowIso();
    const user = freezeCopy({
      id,
      displayName: displayName || id,
      role,
      identities: freezeCopy({}),
      permissions: Object.freeze([...permissions]),
      relationship,
      metadata: freezeCopy(metadata),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    users = Object.freeze([...users.filter((candidate) => candidate.id !== id), user]);
    userIdentities = Object.freeze([
      ...userIdentities.filter((identity) => identity.userId !== id),
      ...createIdentityRows(id, identities, timestamp)
    ]);
    save();
    return hydrateUser(user);
  };

  const updateUser = (userId, patch) => {
    let nextUser = null;
    users = Object.freeze(
      users.map((user) => {
        if (user.id !== userId) {
          return user;
        }
        nextUser = freezeCopy({
          ...user,
          ...patch,
          permissions: Object.freeze([...(patch.permissions || user.permissions)]),
          metadata: freezeCopy(patch.metadata || user.metadata),
          updatedAt: nowIso()
        });
        return nextUser;
      })
    );
    if (!nextUser) {
      throw new Error(`User not found: ${userId}`);
    }
    if (patch.identities) {
      userIdentities = Object.freeze([
        ...userIdentities.filter((identity) => identity.userId !== userId),
        ...createIdentityRows(userId, patch.identities)
      ]);
    }
    save();
    return hydrateUser(nextUser);
  };

  const linkIdentity = ({
    userId,
    platform,
    platformUserId,
    displayName = null,
    metadata = {}
  }) => {
    if (!userId || !platform || !platformUserId) {
      throw new Error("linkIdentity requires userId, platform, and platformUserId");
    }
    if (!users.some((user) => user.id === userId)) {
      throw new Error(`User not found: ${userId}`);
    }
    const timestamp = nowIso();
    const identity = freezeCopy({
      id: createId("identity"),
      userId,
      platform,
      platformUserId: String(platformUserId),
      displayName,
      metadata: freezeCopy(metadata),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    userIdentities = Object.freeze([
      ...userIdentities.filter(
        (candidate) =>
          !(
            candidate.platform === platform &&
            String(candidate.platformUserId) === String(platformUserId)
          )
      ),
      identity
    ]);
    save();
    return identity;
  };

  const setPermissionOverride = ({
    userId,
    permission,
    effect = "allow",
    scope = "global",
    reason = null,
    expiresAt = null,
    metadata = {}
  }) => {
    if (!userId || !permission) {
      throw new Error("setPermissionOverride requires userId and permission");
    }
    if (!["allow", "deny"].includes(effect)) {
      throw new Error("permission override effect must be allow or deny");
    }
    if (!users.some((user) => user.id === userId)) {
      throw new Error(`User not found: ${userId}`);
    }
    const timestamp = nowIso();
    const override = freezeCopy({
      id: createId("permission"),
      userId,
      permission,
      effect,
      scope,
      reason,
      expiresAt,
      metadata: freezeCopy(metadata),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    permissionOverrides = Object.freeze([
      ...permissionOverrides.filter(
        (candidate) =>
          !(
            candidate.userId === userId &&
            candidate.permission === permission &&
            candidate.scope === scope
          )
      ),
      override
    ]);
    save();
    return override;
  };

  const createStreamSession = ({
    id = createId("stream"),
    platform,
    platformChannelId,
    title = null,
    hostUserId = null,
    status = "live",
    metadata = {}
  }) => {
    if (!platform || !platformChannelId) {
      throw new Error("createStreamSession requires platform and platformChannelId");
    }
    const timestamp = nowIso();
    const session = freezeCopy({
      id,
      platform,
      platformChannelId: String(platformChannelId),
      title,
      hostUserId,
      status,
      metadata: freezeCopy(metadata),
      startedAt: timestamp,
      endedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    streamSessions = Object.freeze([
      ...streamSessions.filter((candidate) => candidate.id !== id),
      session
    ]);
    save();
    return session;
  };

  const updateStreamSession = (sessionId, patch) => {
    let nextSession = null;
    streamSessions = Object.freeze(
      streamSessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        nextSession = freezeCopy({
          ...session,
          ...patch,
          metadata: freezeCopy(patch.metadata || session.metadata),
          updatedAt: nowIso()
        });
        return nextSession;
      })
    );
    if (!nextSession) {
      throw new Error(`Stream session not found: ${sessionId}`);
    }
    save();
    return nextSession;
  };

  const findByIdentity = ({ platform, platformUserId }) => {
    if (!platform || !platformUserId) {
      return null;
    }
    const identity = userIdentities.find(
      (candidate) =>
        candidate.platform === platform &&
        String(candidate.platformUserId) === String(platformUserId)
    );
    if (!identity) {
      return null;
    }
    const user = users.find((candidate) => candidate.id === identity.userId);
    return user ? hydrateUser(user) : null;
  };

  const resolveActor = (actor = {}) => {
    const user = findByIdentity(actor);
    if (user) {
      const identity = userIdentities.find(
        (candidate) =>
          candidate.platform === actor.platform &&
          String(candidate.platformUserId) === String(actor.platformUserId)
      );
      return freezeCopy({
        user,
        identity: freezeCopy({
          platform: actor.platform,
          platformUserId: actor.platformUserId,
          displayName: actor.displayName || identity?.displayName || user.displayName
        }),
        known: true
      });
    }
    return freezeCopy({
      user: freezeCopy({
        id: "anonymous",
        displayName: actor.displayName || "Anonymous",
        role: "anonymous",
        identities: freezeCopy(
          actor.platform && actor.platformUserId
            ? { [actor.platform]: actor.platformUserId }
            : {}
        ),
        permissions: Object.freeze(["chat_public"]),
        relationship: "public",
        metadata: freezeCopy({})
      }),
      identity: freezeCopy({
        platform: actor.platform || "unknown",
        platformUserId: actor.platformUserId || "unknown",
        displayName: actor.displayName || "Anonymous"
      }),
      known: false
    });
  };

  const snapshot = () =>
    freezeCopy({
      users: Object.freeze(users.map((user) => hydrateUser(user))),
      userIdentities: Object.freeze([...userIdentities]),
      permissionOverrides: Object.freeze([...permissionOverrides]),
      streamSessions: Object.freeze([...streamSessions])
    });

  return Object.freeze({
    registerUser,
    updateUser,
    linkIdentity,
    setPermissionOverride,
    createStreamSession,
    updateStreamSession,
    findByIdentity,
    resolveActor,
    snapshot
  });
};

export const createCharacterState = ({
  characterId,
  mode = MODES.idle,
  emotion = DEFAULT_EMOTION,
  speechText = null,
  taskRef = null,
  mouth = "closed",
  gaze = "user",
  motion = mode,
  metadata = {}
}) =>
  freezeCopy({
    characterId,
    mode,
    emotion,
    speechText,
    taskRef,
    mouth,
    gaze,
    motion,
    metadata: freezeCopy(metadata)
  });

export const createInMemoryProjectOs = () => {
  return createProjectOsStore();
};

export const createFileProjectOs = ({ path }) => {
  if (!path) {
    throw new Error("createFileProjectOs requires path");
  }
  const load = () => {
    if (!existsSync(path)) {
      return {};
    }
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw);
  };
  const persist = (snapshot) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  };

  return createProjectOsStore(load(), persist);
};

export const createInMemoryUserRegistry = () => createUserRegistryStore();

export const createFileUserRegistry = ({ path }) => {
  if (!path) {
    throw new Error("createFileUserRegistry requires path");
  }
  const load = () => {
    if (!existsSync(path)) {
      return {};
    }
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw);
  };
  const persist = (snapshot) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  };
  return createUserRegistryStore(load(), persist);
};

export const createPermissionPolicy = ({
  rolePermissions = {},
  requiredPermissions = {}
} = {}) => {
  const defaultRolePermissions = {
    owner: ["chat_public", "deep_discussion", "delegate_work", "manage_stream", "manage_users"],
    developer: ["chat_public", "deep_discussion", "delegate_work"],
    moderator: ["chat_public", "deep_discussion", "manage_stream"],
    member: ["chat_public", "deep_discussion"],
    fan: ["chat_public"],
    anonymous: ["chat_public"]
  };
  const permissionsByRole = freezeCopy({
    ...defaultRolePermissions,
    ...rolePermissions
  });
  const requirements = freezeCopy({
    work: "delegate_work",
    deepDiscussion: "deep_discussion",
    manageStream: "manage_stream",
    ...requiredPermissions
  });
  const createContextScopes = (input = {}) => {
    const platform = input.actor?.platform || input.source || null;
    const scopes = [
      "global",
      input.source ? `source:${input.source}` : null,
      platform ? `platform:${platform}` : null,
      input.source ? `stream:${input.source}` : null,
      input.metadata?.streamSessionId ? `streamSession:${input.metadata.streamSessionId}` : null
    ];
    return Object.freeze(scopes.filter(Boolean));
  };
  const permissionsFor = (user, contextScopes = Object.freeze(["global"])) => {
    const basePermissions = [
      ...(permissionsByRole[user.role] || []),
      ...(Array.isArray(user.permissions) ? user.permissions : [])
    ];
    const activeOverrides = Array.isArray(user.permissionOverrides)
      ? user.permissionOverrides.filter(
          (override) =>
            (!override.expiresAt || new Date(override.expiresAt).getTime() > Date.now()) &&
            (override.scope === "global" || contextScopes.includes(override.scope))
        )
      : [];
    const denied = activeOverrides
      .filter((override) => override.effect === "deny")
      .map((override) => override.permission);
    const allowed = activeOverrides
      .filter((override) => override.effect === "allow")
      .map((override) => override.permission);
    return Object.freeze(
      [...new Set([...basePermissions, ...allowed])].filter(
        (permission) => !denied.includes(permission)
      )
    );
  };
  const can = (user, permission, contextScopes) =>
    permissionsFor(user, contextScopes).includes(permission);
  const evaluate = ({ user, route, input }) => {
    const text = input.text.toLowerCase();
    const contextScopes = createContextScopes(input);
    const asksDeepDiscussion =
      text.includes("深い議論") ||
      text.includes("設計") ||
      text.includes("architecture") ||
      text.includes("アーキテクチャ");
    if (route.kind === "work" && !can(user, requirements.work, contextScopes)) {
      return freezeCopy({
        allowed: false,
        permission: requirements.work,
        reason: "delegate_work permission is required"
      });
    }
    if (asksDeepDiscussion && !can(user, requirements.deepDiscussion, contextScopes)) {
      return freezeCopy({
        allowed: false,
        permission: requirements.deepDiscussion,
        reason: "deep_discussion permission is required"
      });
    }
    return freezeCopy({
      allowed: true,
      permission: null,
      reason: "allowed"
    });
  };

  return Object.freeze({
    can,
    createContextScopes,
    evaluate,
    permissionsFor
  });
};

export const createProjectOsMarkdown = (snapshot) => {
  const ticketLines = snapshot.tickets.map(
    (ticket) =>
      `- [${ticket.status}] ${ticket.id}: ${ticket.title} -> ${ticket.executorHarnessId || "unassigned"}`
  );
  const runLines = snapshot.runs.map(
    (run) => `- [${run.status}] ${run.id}: ${run.harnessId} for ${run.ticketId}`
  );
  const artifactLines = snapshot.artifacts.map(
    (artifact) => `- ${artifact.kind}: [${artifact.title}](${artifact.uri})`
  );

  return [
    "# IroHarness Project OS",
    "",
    "## Tickets",
    ticketLines.length ? ticketLines.join("\n") : "- none",
    "",
    "## Runs",
    runLines.length ? runLines.join("\n") : "- none",
    "",
    "## Artifacts",
    artifactLines.length ? artifactLines.join("\n") : "- none",
    ""
  ].join("\n");
};

export const createHeuristicRouter = () => {
  const workSignals = [
    "codex",
    "実装",
    "修正",
    "作って",
    "レビュー",
    "ファイル",
    "コード",
    "openclaw",
    "hermes"
  ];
  const deepSignals = [
    "深い議論",
    "設計",
    "architecture",
    "アーキテクチャ",
    "方針",
    "思想",
    "戦略"
  ];

  const choose = ({ input, microHarnesses }) => {
    const text = input.text.toLowerCase();
    const isWork = workSignals.some((signal) => text.includes(signal.toLowerCase()));
    const isDeep = deepSignals.some((signal) => text.includes(signal.toLowerCase()));
    if (!isWork) {
      return freezeCopy({
        kind: input.modality === "voice" ? "voice" : isDeep ? "deep" : "text",
        harnessId: null,
        reason: isDeep ? "Deep discussion signal detected" : "No work signal detected"
      });
    }

    const mentionedHarness = microHarnesses.find((harness) =>
      text.includes(harness.id.toLowerCase())
    );
    const selectedHarness = mentionedHarness || microHarnesses[0] || null;

    if (!selectedHarness && input.modality !== "voice") {
      if (isDeep) {
        return freezeCopy({
          kind: "deep",
          harnessId: null,
          reason: "Deep discussion signal detected"
        });
      }
    }

    return freezeCopy({
      kind: selectedHarness ? "work" : "text",
      harnessId: selectedHarness ? selectedHarness.id : null,
      reason: selectedHarness
        ? `Delegating to ${selectedHarness.id}`
        : "Work requested but no micro harness is registered"
    });
  };

  return Object.freeze({ choose });
};

export const createEchoBrain = (id) =>
  Object.freeze({
    id,
    async respond({ character, input, route }) {
      const prefix = input.modality === "voice" ? "うん。" : "";
      const text =
        route.kind === "voice"
          ? `${prefix}${character.name}として聞いているよ。`
          : `${prefix}${character.name}として受け取ったよ。`;
      return freezeCopy({
        text,
        emotion: "attentive"
      });
    }
  });

export const createHttpBrain = ({
  id,
  endpoint,
  model = null,
  headers = {},
  fetchImpl = globalThis.fetch
}) => {
  if (!id || !endpoint) {
    throw new Error("createHttpBrain requires id and endpoint");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createHttpBrain requires fetchImpl");
  }
  return Object.freeze({
    id,
    async respond(context) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers
        },
        body: JSON.stringify({
          model,
          character: context.character,
          actor: context.actor,
          input: context.input,
          route: context.route,
          state: context.state,
          projectOs: context.projectOs
        })
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP brain ${id} failed: ${response.status} ${responseText}`);
      }
      const payload = responseText.trim() ? JSON.parse(responseText) : {};
      return freezeCopy({
        text: payload.text || payload.message || "",
        emotion: payload.emotion || "attentive",
        raw: payload
      });
    }
  });
};

export const createStubMicroHarness = (id, capabilities = []) =>
  Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    async run(task) {
      return freezeCopy({
        status: "completed",
        summary: `${id} accepted: ${task.title}`,
        artifacts: Object.freeze([])
      });
    }
  });

export const createRecorderDevice = (id) => {
  let events = [];
  return Object.freeze({
    id,
    kind: "recorder",
    capabilities: Object.freeze(["state", "speech", "task"]),
    emit(event) {
      events = Object.freeze([...events, freezeCopy(event)]);
    },
    events() {
      return Object.freeze([...events]);
    }
  });
};

export const createConsoleDevice = (id = "console") =>
  Object.freeze({
    id,
    kind: "console",
    capabilities: Object.freeze(["state", "speech", "task"]),
    emit(event) {
      if (event.type === "speech") {
        console.log(`[${id}] ${event.text}`);
      }
      if (event.type === "state") {
        console.log(`[${id}] ${event.state.mode}:${event.state.emotion}`);
      }
      if (event.type === "task") {
        console.log(`[${id}] ${event.status} ${event.ticketId}`);
      }
    }
  });

export const createIroHarness = ({
  character,
  projectOs,
  userRegistry = createInMemoryUserRegistry(),
  permissionPolicy = createPermissionPolicy(),
  router = createHeuristicRouter(),
  brains,
  devices = [],
  microHarnesses = []
}) => {
  if (!character || !character.id || !character.name) {
    throw new Error("character.id and character.name are required");
  }
  if (!projectOs) {
    throw new Error("projectOs is required");
  }
  if (!brains || !brains.voice || !brains.text) {
    throw new Error("brains.voice and brains.text are required");
  }

  let state = createCharacterState({
    characterId: character.id,
    mode: MODES.idle,
    emotion: DEFAULT_EMOTION
  });

  const emit = (event) => {
    devices.forEach((device) => device.emit(event));
  };

  const setState = (nextState) => {
    state = createCharacterState({
      characterId: character.id,
      ...nextState
    });
    emit({
      type: "state",
      state,
      timestamp: nowIso()
    });
    return state;
  };

  const receive = async (input) => {
    if (!input || !input.text || !input.modality || !input.source) {
      throw new Error("input.source, input.modality, and input.text are required");
    }
    const actor = userRegistry.resolveActor(input.actor || {});

    setState({
      mode: MODES.thinking,
      emotion: "focused",
      speechText: null,
      mouth: "closed",
      motion: MODES.thinking
    });

    const route = router.choose({
      input,
      character,
      actor,
      microHarnesses
    });

    const permission = permissionPolicy.evaluate({
      user: actor.user,
      route,
      input
    });
    if (!permission.allowed) {
      return rejectByPermission(input, route, actor, permission);
    }

    if (route.kind === "work" && route.harnessId) {
      return runMicroHarness(input, route, actor);
    }

    const brain =
      route.kind === "voice"
        ? brains.voice
        : route.kind === "deep"
          ? brains.deep || brains.text
          : brains.text;
    const response = await brain.respond({
      character,
      input,
      actor,
      route,
      state,
      projectOs: projectOs.snapshot()
    });

    setState({
      mode: MODES.speaking,
      emotion: response.emotion || "attentive",
      speechText: response.text,
      mouth: "talking",
      motion: MODES.speaking
    });
    emit({
      type: "speech",
      text: response.text,
      modality: input.modality,
      brainId: brain.id,
      timestamp: nowIso()
    });
    setState({
      mode: MODES.idle,
      emotion: response.emotion || "attentive",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle
    });

    return freezeCopy({
      kind: "response",
      route,
      actor,
      text: response.text,
      brainId: brain.id
    });
  };

  const rejectByPermission = async (input, route, actor, permission) => {
    const text =
      actor.user.role === "anonymous"
        ? "そこは権限が必要だよ。まず本人確認できる場所から話してね。"
        : "そこは今の権限ではできないよ。必要なら開発者に確認してね。";
    setState({
      mode: MODES.speaking,
      emotion: "careful",
      speechText: text,
      mouth: "talking",
      motion: MODES.speaking,
      metadata: {
        permission: permission.permission,
        actorUserId: actor.user.id
      }
    });
    emit({
      type: "speech",
      text,
      modality: input.modality,
      brainId: "permission-policy",
      timestamp: nowIso()
    });
    setState({
      mode: MODES.idle,
      emotion: "careful",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle,
      metadata: {
        permission: permission.permission,
        actorUserId: actor.user.id
      }
    });
    return freezeCopy({
      kind: "permission_denied",
      route,
      actor,
      permission,
      text
    });
  };

  const runMicroHarness = async (input, route, actor) => {
    const microHarness = microHarnesses.find((candidate) => candidate.id === route.harnessId);
    if (!microHarness) {
      throw new Error(`Micro harness not found: ${route.harnessId}`);
    }

    const ticket = projectOs.createTicket({
      title: input.text.slice(0, 80),
      purpose: input.text,
      acceptance: ["Micro harness returns a status", "PJOS records the run"],
      ownerCharacterId: character.id,
      executorHarnessId: microHarness.id,
      metadata: {
        source: input.source,
        modality: input.modality,
        actorUserId: actor.user.id,
        actorRole: actor.user.role,
        actorPlatform: actor.identity.platform,
        actorPlatformUserId: actor.identity.platformUserId
      }
    });

    setState({
      mode: MODES.working,
      emotion: "focused",
      speechText: "見てみるね。",
      taskRef: ticket.id,
      mouth: "talking",
      motion: MODES.working
    });
    emit({
      type: "speech",
      text: "見てみるね。",
      modality: input.modality,
      brainId: "macro-reflex",
      timestamp: nowIso()
    });
    emit({
      type: "task",
      status: "started",
      ticketId: ticket.id,
      harnessId: microHarness.id,
      timestamp: nowIso()
    });

    const run = projectOs.createRun({
      ticketId: ticket.id,
      harnessId: microHarness.id,
      input
    });
    const output = await microHarness.run(ticket, {
      character,
      actor,
      input,
      projectOs: projectOs.snapshot()
    });
    const completedRun = projectOs.completeRun(run.id, output, output.status);
    const artifacts = Array.isArray(output.artifacts)
      ? output.artifacts.map((artifact) =>
          projectOs.addArtifact({
            ticketId: ticket.id,
            runId: run.id,
            kind: artifact.kind || "generic",
            uri: artifact.uri || "",
            title: artifact.title || artifact.uri || "artifact"
          })
        )
      : [];
    projectOs.updateTicket(ticket.id, {
      status: output.status === "completed" ? "done" : "needs_attention"
    });

    emit({
      type: "task",
      status: output.status,
      ticketId: ticket.id,
      runId: run.id,
      harnessId: microHarness.id,
      summary: output.summary,
      timestamp: nowIso()
    });
    setState({
      mode: MODES.idle,
      emotion: "relieved",
      speechText: null,
      taskRef: ticket.id,
      mouth: "closed",
      motion: MODES.idle
    });

    return freezeCopy({
      kind: "delegation",
      route,
      actor,
      ticket,
      run: completedRun,
      output,
      artifacts: Object.freeze(artifacts)
    });
  };

  return Object.freeze({
    character: freezeCopy(character),
    receive,
    state: () => state,
    projectOs: () => projectOs.snapshot(),
    users: () => userRegistry.snapshot()
  });
};

export const constants = Object.freeze({
  MODES
});
