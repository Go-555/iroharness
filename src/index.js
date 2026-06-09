import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Plain one-way import of the skills subsystem (no cycle back into this file).
import { createSkillContextListing, gateSkills } from "./skills/index.js";

const MODES = Object.freeze({
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  working: "working",
  error: "error",
});

const DEFAULT_EMOTION = "neutral";

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

const freezeCopy = (value) => Object.freeze({ ...value });

const freezeArray = (value = []) => Object.freeze([...value]);

const dbRows = (result) => Object.freeze([...(result?.rows || result || [])]);

const dbOne = (result) => dbRows(result)[0] || null;

const fromDbUser = (row) =>
  row
    ? freezeCopy({
        id: row.id,
        displayName: row.display_name ?? row.displayName,
        role: row.role,
        identities: freezeCopy({}),
        permissions: freezeArray(row.permissions || []),
        relationship: row.relationship,
        metadata: freezeCopy(row.metadata || {}),
        createdAt: row.created_at ?? row.createdAt,
        updatedAt: row.updated_at ?? row.updatedAt,
      })
    : null;

const fromDbIdentity = (row) =>
  row
    ? freezeCopy({
        id: row.id,
        userId: row.user_id ?? row.userId,
        platform: row.platform,
        platformUserId: String(row.platform_user_id ?? row.platformUserId),
        displayName: row.display_name ?? row.displayName ?? null,
        metadata: freezeCopy(row.metadata || {}),
        createdAt: row.created_at ?? row.createdAt,
        updatedAt: row.updated_at ?? row.updatedAt,
      })
    : null;

const fromDbPermissionOverride = (row) =>
  row
    ? freezeCopy({
        id: row.id,
        userId: row.user_id ?? row.userId,
        permission: row.permission,
        effect: row.effect,
        scope: row.scope,
        reason: row.reason ?? null,
        expiresAt: row.expires_at ?? row.expiresAt ?? null,
        metadata: freezeCopy(row.metadata || {}),
        createdAt: row.created_at ?? row.createdAt,
        updatedAt: row.updated_at ?? row.updatedAt,
      })
    : null;

const fromDbStreamSession = (row) =>
  row
    ? freezeCopy({
        id: row.id,
        platform: row.platform,
        platformChannelId: String(
          row.platform_channel_id ?? row.platformChannelId,
        ),
        title: row.title ?? null,
        hostUserId: row.host_user_id ?? row.hostUserId ?? null,
        status: row.status,
        metadata: freezeCopy(row.metadata || {}),
        startedAt: row.started_at ?? row.startedAt,
        endedAt: row.ended_at ?? row.endedAt ?? null,
        createdAt: row.created_at ?? row.createdAt,
        updatedAt: row.updated_at ?? row.updatedAt,
      })
    : null;

const fromDbAuditRecord = (row) =>
  row
    ? freezeCopy({
        id: row.id,
        action: row.action,
        resourceType: row.resource_type ?? row.resourceType,
        resourceId: row.resource_id ?? row.resourceId,
        userId: row.user_id ?? row.userId ?? null,
        metadata: freezeCopy(row.metadata || {}),
        createdAt: row.created_at ?? row.createdAt,
      })
    : null;

const hydrateUserWithRows = ({
  user,
  identities = [],
  permissionOverrides = [],
}) =>
  freezeCopy({
    ...user,
    identities: createIdentitiesObject(identities, user.id),
    permissions: freezeArray(user.permissions || []),
    metadata: freezeCopy(user.metadata || {}),
    permissionOverrides: freezeArray(
      permissionOverrides.filter((override) => override.userId === user.id),
    ),
  });

const createProjectOsStore = (initialState = {}, persist = () => {}) => {
  let tickets = Object.freeze([...(initialState.tickets || [])]);
  let runs = Object.freeze([...(initialState.runs || [])]);
  let artifacts = Object.freeze([...(initialState.artifacts || [])]);

  const rawSnapshot = () => ({
    tickets: [...tickets],
    runs: [...runs],
    artifacts: [...artifacts],
  });

  const save = () => persist(rawSnapshot());

  const createTicket = ({
    title,
    purpose,
    acceptance = [],
    ownerCharacterId,
    executorHarnessId = null,
    metadata = {},
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
      metadata: freezeCopy(metadata),
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
          updatedAt: nowIso(),
        });
        return nextTicket;
      }),
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
      updatedAt: nowIso(),
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
          updatedAt: nowIso(),
        });
        return nextRun;
      }),
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
      createdAt: nowIso(),
    });
    artifacts = Object.freeze([...artifacts, artifact]);
    save();
    return artifact;
  };

  const snapshot = () =>
    freezeCopy({
      tickets: Object.freeze([...tickets]),
      runs: Object.freeze([...runs]),
      artifacts: Object.freeze([...artifacts]),
    });

  return Object.freeze({
    createTicket,
    updateTicket,
    createRun,
    completeRun,
    addArtifact,
    snapshot,
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
        updatedAt: createdAt,
      }),
    ),
  );

const createIdentitiesObject = (identityRows, userId) =>
  freezeCopy(
    identityRows
      .filter((identity) => identity.userId === userId)
      .reduce(
        (identities, identity) => ({
          ...identities,
          [identity.platform]: identity.platformUserId,
        }),
        {},
      ),
  );

const createUserRegistryStore = (initialState = {}, persist = () => {}) => {
  let users = Object.freeze([...(initialState.users || [])]);
  let userIdentities = Object.freeze(
    initialState.userIdentities
      ? [...initialState.userIdentities]
      : users.flatMap((user) =>
          createIdentityRows(user.id, user.identities || {}),
        ),
  );
  let permissionOverrides = Object.freeze([
    ...(initialState.permissionOverrides || []),
  ]);
  let streamSessions = Object.freeze([...(initialState.streamSessions || [])]);
  let auditLog = Object.freeze([...(initialState.auditLog || [])]);

  const hydrateUser = (user) =>
    freezeCopy({
      ...user,
      identities: createIdentitiesObject(userIdentities, user.id),
      permissions: Object.freeze([...(user.permissions || [])]),
      metadata: freezeCopy(user.metadata || {}),
      permissionOverrides: Object.freeze(
        permissionOverrides.filter((override) => override.userId === user.id),
      ),
    });

  const save = () =>
    persist({
      users: [...users],
      userIdentities: [...userIdentities],
      permissionOverrides: [...permissionOverrides],
      streamSessions: [...streamSessions],
      auditLog: [...auditLog],
    });

  const appendAuditLog = ({
    action,
    resourceType,
    resourceId,
    userId = null,
    metadata = {},
  }) => {
    const timestamp = nowIso();
    auditLog = Object.freeze([
      ...auditLog,
      freezeCopy({
        id: createId("audit"),
        action,
        resourceType,
        resourceId,
        userId,
        metadata: freezeCopy(metadata),
        createdAt: timestamp,
      }),
    ]);
  };

  const registerUser = ({
    id = createId("user"),
    displayName,
    role = "fan",
    identities = {},
    permissions = [],
    relationship = "public",
    metadata = {},
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
      updatedAt: timestamp,
    });
    users = Object.freeze([
      ...users.filter((candidate) => candidate.id !== id),
      user,
    ]);
    userIdentities = Object.freeze([
      ...userIdentities.filter((identity) => identity.userId !== id),
      ...createIdentityRows(id, identities, timestamp),
    ]);
    appendAuditLog({
      action: "audience.user.register",
      resourceType: "user",
      resourceId: id,
      userId: id,
      metadata: { role, relationship },
    });
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
          permissions: Object.freeze([
            ...(patch.permissions || user.permissions),
          ]),
          metadata: freezeCopy(patch.metadata || user.metadata),
          updatedAt: nowIso(),
        });
        return nextUser;
      }),
    );
    if (!nextUser) {
      throw new Error(`User not found: ${userId}`);
    }
    if (patch.identities) {
      userIdentities = Object.freeze([
        ...userIdentities.filter((identity) => identity.userId !== userId),
        ...createIdentityRows(userId, patch.identities),
      ]);
    }
    appendAuditLog({
      action: "audience.user.update",
      resourceType: "user",
      resourceId: userId,
      userId,
      metadata: { fields: Object.keys(patch || {}) },
    });
    save();
    return hydrateUser(nextUser);
  };

  const linkIdentity = ({
    userId,
    platform,
    platformUserId,
    displayName = null,
    metadata = {},
  }) => {
    if (!userId || !platform || !platformUserId) {
      throw new Error(
        "linkIdentity requires userId, platform, and platformUserId",
      );
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
      updatedAt: timestamp,
    });
    userIdentities = Object.freeze([
      ...userIdentities.filter(
        (candidate) =>
          !(
            candidate.platform === platform &&
            String(candidate.platformUserId) === String(platformUserId)
          ),
      ),
      identity,
    ]);
    appendAuditLog({
      action: "audience.identity.link",
      resourceType: "identity",
      resourceId: identity.id,
      userId,
      metadata: { platform, platformUserId: String(platformUserId) },
    });
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
    metadata = {},
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
      updatedAt: timestamp,
    });
    permissionOverrides = Object.freeze([
      ...permissionOverrides.filter(
        (candidate) =>
          !(
            candidate.userId === userId &&
            candidate.permission === permission &&
            candidate.scope === scope
          ),
      ),
      override,
    ]);
    appendAuditLog({
      action: "audience.permission.set",
      resourceType: "permissionOverride",
      resourceId: override.id,
      userId,
      metadata: { permission, effect, scope, expiresAt },
    });
    save();
    return override;
  };

  const deletePermissionOverride = ({
    userId,
    permission,
    scope = "global",
  }) => {
    if (!userId || !permission) {
      throw new Error(
        "deletePermissionOverride requires userId and permission",
      );
    }
    const before = permissionOverrides.length;
    permissionOverrides = Object.freeze(
      permissionOverrides.filter(
        (candidate) =>
          !(
            candidate.userId === userId &&
            candidate.permission === permission &&
            candidate.scope === scope
          ),
      ),
    );
    appendAuditLog({
      action: "audience.permission.delete",
      resourceType: "permissionOverride",
      resourceId: `${userId}:${permission}:${scope}`,
      userId,
      metadata: {
        permission,
        scope,
        deleted: before !== permissionOverrides.length,
      },
    });
    save();
    return freezeCopy({
      userId,
      permission,
      scope,
      deleted: before !== permissionOverrides.length,
    });
  };

  const createStreamSession = ({
    id = createId("stream"),
    platform,
    platformChannelId,
    title = null,
    hostUserId = null,
    status = "live",
    metadata = {},
  }) => {
    if (!platform || !platformChannelId) {
      throw new Error(
        "createStreamSession requires platform and platformChannelId",
      );
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
      updatedAt: timestamp,
    });
    streamSessions = Object.freeze([
      ...streamSessions.filter((candidate) => candidate.id !== id),
      session,
    ]);
    appendAuditLog({
      action: "audience.stream.create",
      resourceType: "streamSession",
      resourceId: session.id,
      userId: hostUserId,
      metadata: {
        platform,
        platformChannelId: String(platformChannelId),
        status,
      },
    });
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
          updatedAt: nowIso(),
        });
        return nextSession;
      }),
    );
    if (!nextSession) {
      throw new Error(`Stream session not found: ${sessionId}`);
    }
    appendAuditLog({
      action: "audience.stream.update",
      resourceType: "streamSession",
      resourceId: sessionId,
      userId: nextSession.hostUserId || null,
      metadata: { fields: Object.keys(patch || {}) },
    });
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
        String(candidate.platformUserId) === String(platformUserId),
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
          String(candidate.platformUserId) === String(actor.platformUserId),
      );
      return freezeCopy({
        user,
        identity: freezeCopy({
          platform: actor.platform,
          platformUserId: actor.platformUserId,
          displayName:
            actor.displayName || identity?.displayName || user.displayName,
        }),
        known: true,
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
            : {},
        ),
        permissions: Object.freeze(["chat_public"]),
        relationship: "public",
        metadata: freezeCopy({}),
      }),
      identity: freezeCopy({
        platform: actor.platform || "unknown",
        platformUserId: actor.platformUserId || "unknown",
        displayName: actor.displayName || "Anonymous",
      }),
      known: false,
    });
  };

  const snapshot = () =>
    freezeCopy({
      users: Object.freeze(users.map((user) => hydrateUser(user))),
      userIdentities: Object.freeze([...userIdentities]),
      permissionOverrides: Object.freeze([...permissionOverrides]),
      streamSessions: Object.freeze([...streamSessions]),
      auditLog: Object.freeze([...auditLog]),
    });

  return Object.freeze({
    registerUser,
    updateUser,
    linkIdentity,
    setPermissionOverride,
    deletePermissionOverride,
    createStreamSession,
    updateStreamSession,
    findByIdentity,
    resolveActor,
    snapshot,
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
  metadata = {},
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
    metadata: freezeCopy(metadata),
  });

const readOptionalMarkdown = (path) => {
  if (!path || !existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, "utf8").trim();
  return text || null;
};

export const createFileCharacterProfile = ({
  dir = ".",
  id = null,
  name = null,
  soulFile = "SOUL.md",
  identityFile = "IDENTITY.md",
  memoryFile = "MEMORY.md",
  voiceFile = "VOICE.md",
  metadata = {},
} = {}) => {
  const characterId = id || basename(dir) || "character";
  const characterName = name || characterId;
  const paths = freezeCopy({
    soul: join(dir, soulFile),
    identity: join(dir, identityFile),
    memory: join(dir, memoryFile),
    voice: join(dir, voiceFile),
  });
  const soul = readOptionalMarkdown(paths.soul);
  const identity = readOptionalMarkdown(paths.identity);
  const memory = readOptionalMarkdown(paths.memory);
  const voice = readOptionalMarkdown(paths.voice);

  return freezeCopy({
    id: characterId,
    name: characterName,
    soul:
      soul ||
      identity ||
      `${characterName} owns identity inside the macro harness.`,
    voiceStyle: voice || "natural, responsive",
    identity,
    memory,
    metadata: freezeCopy({
      ...metadata,
      sourceFiles: paths,
    }),
  });
};

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

export const createPostgresUserRegistry = ({ query }) => {
  if (typeof query !== "function") {
    throw new Error("createPostgresUserRegistry requires query");
  }

  const run = async (sql, params = []) => query(sql, params);

  const appendAuditLog = async ({
    action,
    resourceType,
    resourceId,
    userId = null,
    metadata = {},
  }) =>
    run(
      [
        "insert into iroharness_audit_log",
        "(id, action, resource_type, resource_id, user_id, metadata)",
        "values ($1, $2, $3, $4, $5, $6)",
        "returning *",
      ].join(" "),
      [
        createId("audit"),
        action,
        resourceType,
        String(resourceId),
        userId,
        metadata,
      ],
    );

  const loadUserContext = async (userId) => {
    const [userResult, identityResult, overrideResult] = await Promise.all([
      run("select * from iroharness_users where id = $1", [userId]),
      run(
        "select * from iroharness_user_identities where user_id = $1 order by created_at asc",
        [userId],
      ),
      run(
        "select * from iroharness_permission_overrides where user_id = $1 order by created_at asc",
        [userId],
      ),
    ]);
    const user = fromDbUser(dbOne(userResult));
    if (!user) {
      return null;
    }
    return hydrateUserWithRows({
      user,
      identities: dbRows(identityResult).map(fromDbIdentity).filter(Boolean),
      permissionOverrides: dbRows(overrideResult)
        .map(fromDbPermissionOverride)
        .filter(Boolean),
    });
  };

  const registerUser = async ({
    id = createId("user"),
    displayName,
    role = "fan",
    identities = {},
    permissions = [],
    relationship = "public",
    metadata = {},
  }) => {
    const userResult = await run(
      [
        "insert into iroharness_users",
        "(id, display_name, role, relationship, permissions, metadata)",
        "values ($1, $2, $3, $4, $5, $6)",
        "on conflict (id) do update set",
        "display_name = excluded.display_name,",
        "role = excluded.role,",
        "relationship = excluded.relationship,",
        "permissions = excluded.permissions,",
        "metadata = excluded.metadata",
        "returning *",
      ].join(" "),
      [id, displayName || id, role, relationship, permissions, metadata],
    );
    await run("delete from iroharness_user_identities where user_id = $1", [
      id,
    ]);
    const identityRows = [];
    for (const [platform, platformUserId] of Object.entries(identities)) {
      const identity = await run(
        [
          "insert into iroharness_user_identities",
          "(id, user_id, platform, platform_user_id, display_name, metadata)",
          "values ($1, $2, $3, $4, $5, $6)",
          "on conflict (platform, platform_user_id) do update set",
          "user_id = excluded.user_id,",
          "display_name = excluded.display_name,",
          "metadata = excluded.metadata",
          "returning *",
        ].join(" "),
        [createId("identity"), id, platform, String(platformUserId), null, {}],
      );
      identityRows.push(fromDbIdentity(dbOne(identity)));
    }
    await appendAuditLog({
      action: "audience.user.register",
      resourceType: "user",
      resourceId: id,
      userId: id,
      metadata: { role, relationship },
    });
    return hydrateUserWithRows({
      user: fromDbUser(dbOne(userResult)),
      identities: identityRows.filter(Boolean),
    });
  };

  const updateUser = async (userId, patch) => {
    const current = await loadUserContext(userId);
    if (!current) {
      throw new Error(`User not found: ${userId}`);
    }
    const next = {
      displayName: patch.displayName ?? current.displayName,
      role: patch.role ?? current.role,
      relationship: patch.relationship ?? current.relationship,
      permissions: patch.permissions || current.permissions,
      metadata: patch.metadata || current.metadata,
    };
    const result = await run(
      [
        "update iroharness_users set",
        "display_name = $2, role = $3, relationship = $4, permissions = $5, metadata = $6",
        "where id = $1 returning *",
      ].join(" "),
      [
        userId,
        next.displayName,
        next.role,
        next.relationship,
        next.permissions,
        next.metadata,
      ],
    );
    if (patch.identities) {
      await run("delete from iroharness_user_identities where user_id = $1", [
        userId,
      ]);
      for (const [platform, platformUserId] of Object.entries(
        patch.identities,
      )) {
        await linkIdentity({
          userId,
          platform,
          platformUserId,
        });
      }
    }
    const user = fromDbUser(dbOne(result));
    await appendAuditLog({
      action: "audience.user.update",
      resourceType: "user",
      resourceId: userId,
      userId,
      metadata: { fields: Object.keys(patch || {}) },
    });
    return loadUserContext(user.id);
  };

  const linkIdentity = async ({
    userId,
    platform,
    platformUserId,
    displayName = null,
    metadata = {},
  }) => {
    if (!userId || !platform || !platformUserId) {
      throw new Error(
        "linkIdentity requires userId, platform, and platformUserId",
      );
    }
    const user = await loadUserContext(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    const result = await run(
      [
        "insert into iroharness_user_identities",
        "(id, user_id, platform, platform_user_id, display_name, metadata)",
        "values ($1, $2, $3, $4, $5, $6)",
        "on conflict (platform, platform_user_id) do update set",
        "user_id = excluded.user_id,",
        "display_name = excluded.display_name,",
        "metadata = excluded.metadata",
        "returning *",
      ].join(" "),
      [
        createId("identity"),
        userId,
        platform,
        String(platformUserId),
        displayName,
        metadata,
      ],
    );
    const identity = fromDbIdentity(dbOne(result));
    await appendAuditLog({
      action: "audience.identity.link",
      resourceType: "identity",
      resourceId: identity.id,
      userId,
      metadata: { platform, platformUserId: String(platformUserId) },
    });
    return identity;
  };

  const setPermissionOverride = async ({
    userId,
    permission,
    effect = "allow",
    scope = "global",
    reason = null,
    expiresAt = null,
    metadata = {},
  }) => {
    if (!userId || !permission) {
      throw new Error("setPermissionOverride requires userId and permission");
    }
    if (!["allow", "deny"].includes(effect)) {
      throw new Error("permission override effect must be allow or deny");
    }
    const user = await loadUserContext(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    const result = await run(
      [
        "insert into iroharness_permission_overrides",
        "(id, user_id, permission, effect, scope, reason, expires_at, metadata)",
        "values ($1, $2, $3, $4, $5, $6, $7, $8)",
        "on conflict (user_id, permission, scope) do update set",
        "effect = excluded.effect,",
        "reason = excluded.reason,",
        "expires_at = excluded.expires_at,",
        "metadata = excluded.metadata",
        "returning *",
      ].join(" "),
      [
        createId("permission"),
        userId,
        permission,
        effect,
        scope,
        reason,
        expiresAt,
        metadata,
      ],
    );
    const override = fromDbPermissionOverride(dbOne(result));
    await appendAuditLog({
      action: "audience.permission.set",
      resourceType: "permissionOverride",
      resourceId: override.id,
      userId,
      metadata: { permission, effect, scope, expiresAt },
    });
    return override;
  };

  const deletePermissionOverride = async ({
    userId,
    permission,
    scope = "global",
  }) => {
    if (!userId || !permission) {
      throw new Error(
        "deletePermissionOverride requires userId and permission",
      );
    }
    const result = await run(
      [
        "delete from iroharness_permission_overrides",
        "where user_id = $1 and permission = $2 and scope = $3",
        "returning *",
      ].join(" "),
      [userId, permission, scope],
    );
    const deleted = dbRows(result).length > 0;
    await appendAuditLog({
      action: "audience.permission.delete",
      resourceType: "permissionOverride",
      resourceId: `${userId}:${permission}:${scope}`,
      userId,
      metadata: { permission, scope, deleted },
    });
    return freezeCopy({
      userId,
      permission,
      scope,
      deleted,
    });
  };

  const createStreamSession = async ({
    id = createId("stream"),
    platform,
    platformChannelId,
    title = null,
    hostUserId = null,
    status = "live",
    metadata = {},
  }) => {
    if (!platform || !platformChannelId) {
      throw new Error(
        "createStreamSession requires platform and platformChannelId",
      );
    }
    const result = await run(
      [
        "insert into iroharness_stream_sessions",
        "(id, platform, platform_channel_id, title, host_user_id, status, metadata)",
        "values ($1, $2, $3, $4, $5, $6, $7)",
        "on conflict (id) do update set",
        "platform = excluded.platform,",
        "platform_channel_id = excluded.platform_channel_id,",
        "title = excluded.title,",
        "host_user_id = excluded.host_user_id,",
        "status = excluded.status,",
        "metadata = excluded.metadata",
        "returning *",
      ].join(" "),
      [
        id,
        platform,
        String(platformChannelId),
        title,
        hostUserId,
        status,
        metadata,
      ],
    );
    const session = fromDbStreamSession(dbOne(result));
    await appendAuditLog({
      action: "audience.stream.create",
      resourceType: "streamSession",
      resourceId: session.id,
      userId: hostUserId,
      metadata: {
        platform,
        platformChannelId: String(platformChannelId),
        status,
      },
    });
    return session;
  };

  const updateStreamSession = async (sessionId, patch) => {
    const current = fromDbStreamSession(
      dbOne(
        await run("select * from iroharness_stream_sessions where id = $1", [
          sessionId,
        ]),
      ),
    );
    if (!current) {
      throw new Error(`Stream session not found: ${sessionId}`);
    }
    const next = {
      title: patch.title ?? current.title,
      hostUserId: patch.hostUserId ?? current.hostUserId,
      status: patch.status ?? current.status,
      metadata: patch.metadata || current.metadata,
      endedAt: patch.endedAt ?? current.endedAt,
    };
    const result = await run(
      [
        "update iroharness_stream_sessions set",
        "title = $2, host_user_id = $3, status = $4, metadata = $5, ended_at = $6",
        "where id = $1 returning *",
      ].join(" "),
      [
        sessionId,
        next.title,
        next.hostUserId,
        next.status,
        next.metadata,
        next.endedAt,
      ],
    );
    const session = fromDbStreamSession(dbOne(result));
    await appendAuditLog({
      action: "audience.stream.update",
      resourceType: "streamSession",
      resourceId: sessionId,
      userId: session.hostUserId,
      metadata: { fields: Object.keys(patch || {}) },
    });
    return session;
  };

  const findByIdentity = async ({ platform, platformUserId }) => {
    if (!platform || !platformUserId) {
      return null;
    }
    const identity = fromDbIdentity(
      dbOne(
        await run(
          "select * from iroharness_user_identities where platform = $1 and platform_user_id = $2",
          [platform, String(platformUserId)],
        ),
      ),
    );
    return identity ? loadUserContext(identity.userId) : null;
  };

  const resolveActor = async (actor = {}) => {
    const user = await findByIdentity(actor);
    if (user) {
      const identityResult = await run(
        "select * from iroharness_user_identities where platform = $1 and platform_user_id = $2",
        [actor.platform, String(actor.platformUserId)],
      );
      const identity = fromDbIdentity(dbOne(identityResult));
      return freezeCopy({
        user,
        identity: freezeCopy({
          platform: actor.platform,
          platformUserId: actor.platformUserId,
          displayName:
            actor.displayName || identity?.displayName || user.displayName,
        }),
        known: true,
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
            : {},
        ),
        permissions: Object.freeze(["chat_public"]),
        relationship: "public",
        metadata: freezeCopy({}),
      }),
      identity: freezeCopy({
        platform: actor.platform || "unknown",
        platformUserId: actor.platformUserId || "unknown",
        displayName: actor.displayName || "Anonymous",
      }),
      known: false,
    });
  };

  const snapshot = async () => {
    const [
      usersResult,
      identitiesResult,
      overridesResult,
      streamsResult,
      auditResult,
    ] = await Promise.all([
      run("select * from iroharness_users order by created_at asc"),
      run("select * from iroharness_user_identities order by created_at asc"),
      run(
        "select * from iroharness_permission_overrides order by created_at asc",
      ),
      run("select * from iroharness_stream_sessions order by created_at asc"),
      run("select * from iroharness_audit_log order by created_at asc"),
    ]);
    const users = dbRows(usersResult).map(fromDbUser).filter(Boolean);
    const userIdentities = dbRows(identitiesResult)
      .map(fromDbIdentity)
      .filter(Boolean);
    const permissionOverrides = dbRows(overridesResult)
      .map(fromDbPermissionOverride)
      .filter(Boolean);
    return freezeCopy({
      users: freezeArray(
        users.map((user) =>
          hydrateUserWithRows({
            user,
            identities: userIdentities,
            permissionOverrides,
          }),
        ),
      ),
      userIdentities: freezeArray(userIdentities),
      permissionOverrides: freezeArray(permissionOverrides),
      streamSessions: freezeArray(
        dbRows(streamsResult).map(fromDbStreamSession).filter(Boolean),
      ),
      auditLog: freezeArray(
        dbRows(auditResult).map(fromDbAuditRecord).filter(Boolean),
      ),
    });
  };

  return Object.freeze({
    registerUser,
    updateUser,
    linkIdentity,
    setPermissionOverride,
    deletePermissionOverride,
    createStreamSession,
    updateStreamSession,
    findByIdentity,
    resolveActor,
    snapshot,
  });
};

export const createPermissionPolicy = ({
  rolePermissions = {},
  requiredPermissions = {},
} = {}) => {
  const defaultRolePermissions = {
    owner: [
      "chat_public",
      "deep_discussion",
      "delegate_work",
      "manage_stream",
      "manage_users",
    ],
    developer: ["chat_public", "deep_discussion", "delegate_work"],
    moderator: ["chat_public", "deep_discussion", "manage_stream"],
    member: ["chat_public", "deep_discussion"],
    fan: ["chat_public"],
    anonymous: ["chat_public"],
  };
  const permissionsByRole = freezeCopy({
    ...defaultRolePermissions,
    ...rolePermissions,
  });
  const requirements = freezeCopy({
    work: "delegate_work",
    deepDiscussion: "deep_discussion",
    manageStream: "manage_stream",
    ...requiredPermissions,
  });
  const createContextScopes = (input = {}) => {
    const platform = input.actor?.platform || input.source || null;
    const scopes = [
      "global",
      input.source ? `source:${input.source}` : null,
      platform ? `platform:${platform}` : null,
      input.source ? `stream:${input.source}` : null,
      input.metadata?.streamSessionId
        ? `streamSession:${input.metadata.streamSessionId}`
        : null,
    ];
    return Object.freeze(scopes.filter(Boolean));
  };
  const permissionsFor = (user, contextScopes = Object.freeze(["global"])) => {
    const basePermissions = [
      ...(permissionsByRole[user.role] || []),
      ...(Array.isArray(user.permissions) ? user.permissions : []),
    ];
    const activeOverrides = Array.isArray(user.permissionOverrides)
      ? user.permissionOverrides.filter(
          (override) =>
            (!override.expiresAt ||
              new Date(override.expiresAt).getTime() > Date.now()) &&
            (override.scope === "global" ||
              contextScopes.includes(override.scope)),
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
        (permission) => !denied.includes(permission),
      ),
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
        reason: "delegate_work permission is required",
      });
    }
    if (
      route.kind === "stream" &&
      !can(user, requirements.manageStream, contextScopes)
    ) {
      return freezeCopy({
        allowed: false,
        permission: requirements.manageStream,
        reason: "manage_stream permission is required",
      });
    }
    if (
      asksDeepDiscussion &&
      !can(user, requirements.deepDiscussion, contextScopes)
    ) {
      return freezeCopy({
        allowed: false,
        permission: requirements.deepDiscussion,
        reason: "deep_discussion permission is required",
      });
    }
    return freezeCopy({
      allowed: true,
      permission: null,
      reason: "allowed",
    });
  };

  return Object.freeze({
    can,
    createContextScopes,
    evaluate,
    permissionsFor,
  });
};

export const createAudienceContextPolicy = ({
  trustedRoles = ["owner", "developer"],
  memberRoles = ["member", "moderator"],
  operatorRoles = ["owner", "moderator"],
} = {}) => {
  const trusted = new Set(trustedRoles);
  const members = new Set(memberRoles);
  const operators = new Set(operatorRoles);
  const hasPermission = (permissions, permission) =>
    permissions.includes(permission);
  const tierFor = (role) => {
    if (role === "owner") {
      return "owner";
    }
    if (trusted.has(role)) {
      return "trusted";
    }
    if (operators.has(role)) {
      return "operator";
    }
    if (members.has(role)) {
      return "member";
    }
    return role === "anonymous" ? "anonymous" : "public";
  };
  const responseDepthFor = ({ route, permissions }) => {
    if (route.kind === "voice") {
      return "brief";
    }
    if (
      route.kind === "deep" &&
      hasPermission(permissions, "deep_discussion")
    ) {
      return "deep";
    }
    if (hasPermission(permissions, "deep_discussion")) {
      return "standard";
    }
    return "public";
  };

  const resolve = ({
    actor,
    route,
    input,
    permissions = [],
    contextScopes = [],
  }) => {
    const role = actor?.user?.role || "anonymous";
    return freezeCopy({
      role,
      relationship: actor?.user?.relationship || "public",
      tier: tierFor(role),
      actorKnown: Boolean(actor?.known),
      source: input?.source || "unknown",
      modality: input?.modality || "text",
      routeKind: route?.kind || "text",
      responseDepth: responseDepthFor({ route: route || {}, permissions }),
      permissions: freezeArray(permissions),
      contextScopes: freezeArray(contextScopes),
      canDeepDiscuss: hasPermission(permissions, "deep_discussion"),
      canDelegateWork: hasPermission(permissions, "delegate_work"),
      canManageStream: hasPermission(permissions, "manage_stream"),
      identityStable: true,
    });
  };

  return Object.freeze({ resolve });
};

export const createProjectOsMarkdown = (snapshot) => {
  const ticketLines = snapshot.tickets.map(
    (ticket) =>
      `- [${ticket.status}] ${ticket.id}: ${ticket.title} -> ${ticket.executorHarnessId || "unassigned"}`,
  );
  const runLines = snapshot.runs.map(
    (run) =>
      `- [${run.status}] ${run.id}: ${run.harnessId} for ${run.ticketId}`,
  );
  const artifactLines = snapshot.artifacts.map(
    (artifact) => `- ${artifact.kind}: [${artifact.title}](${artifact.uri})`,
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
    "",
  ].join("\n");
};

export const createHeuristicRouter = () => {
  const streamSignals = [
    "obs",
    "overlay",
    "scene",
    "stream",
    "配信",
    "シーン",
    "オーバーレイ",
    "ミュート",
    "mute",
  ];
  const workSignals = [
    "codex",
    "実装",
    "修正",
    "作って",
    "レビュー",
    "ファイル",
    "コード",
    "openclaw",
    "hermes",
  ];
  const deepSignals = [
    "深い議論",
    "設計",
    "architecture",
    "アーキテクチャ",
    "方針",
    "思想",
    "戦略",
  ];

  const choose = ({ input, microHarnesses }) => {
    const text = input.text.toLowerCase();
    const isStream = streamSignals.some((signal) =>
      text.includes(signal.toLowerCase()),
    );
    const isWork = workSignals.some((signal) =>
      text.includes(signal.toLowerCase()),
    );
    const isDeep = deepSignals.some((signal) =>
      text.includes(signal.toLowerCase()),
    );
    if (isStream) {
      return freezeCopy({
        kind: "stream",
        harnessId: null,
        reason: "Stream operation signal detected",
      });
    }
    if (!isWork) {
      return freezeCopy({
        kind: input.modality === "voice" ? "voice" : isDeep ? "deep" : "text",
        harnessId: null,
        reason: isDeep
          ? "Deep discussion signal detected"
          : "No work signal detected",
      });
    }

    const mentionedHarness = microHarnesses.find((harness) =>
      text.includes(harness.id.toLowerCase()),
    );
    const selectedHarness = mentionedHarness || microHarnesses[0] || null;

    if (!selectedHarness && input.modality !== "voice") {
      if (isDeep) {
        return freezeCopy({
          kind: "deep",
          harnessId: null,
          reason: "Deep discussion signal detected",
        });
      }
    }

    return freezeCopy({
      kind: selectedHarness ? "work" : "text",
      harnessId: selectedHarness ? selectedHarness.id : null,
      reason: selectedHarness
        ? `Delegating to ${selectedHarness.id}`
        : "Work requested but no micro harness is registered",
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
        emotion: "attentive",
      });
    },
  });

export const createHttpBrain = ({
  id,
  endpoint,
  model = null,
  headers = {},
  fetchImpl = globalThis.fetch,
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
          ...headers,
        },
        body: JSON.stringify({
          model,
          character: context.character,
          actor: context.actor,
          audience: context.audience,
          input: context.input,
          route: context.route,
          state: context.state,
          projectOs: context.projectOs,
        }),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `HTTP brain ${id} failed: ${response.status} ${responseText}`,
        );
      }
      const payload = responseText.trim() ? JSON.parse(responseText) : {};
      return freezeCopy({
        text: payload.text || payload.message || "",
        emotion: payload.emotion || "attentive",
        raw: payload,
      });
    },
  });
};

export const createRealtimeLatencyTracker = ({
  clock = () => Date.now(),
} = {}) => {
  let marks = Object.freeze({});
  let measures = Object.freeze([]);

  const mark = (name, at = clock()) => {
    marks = freezeCopy({
      ...marks,
      [name]: at,
    });
    return freezeCopy({ name, at });
  };

  const measure = (name, startMark, endMark) => {
    const start = marks[startMark];
    const end = marks[endMark];
    if (typeof start !== "number" || typeof end !== "number") {
      throw new Error(
        `latency measure ${name} requires marks: ${startMark}, ${endMark}`,
      );
    }
    const metric = freezeCopy({
      name,
      startMark,
      endMark,
      start,
      end,
      durationMs: end - start,
    });
    measures = Object.freeze([...measures, metric]);
    return metric;
  };

  const snapshot = () =>
    freezeCopy({
      marks: freezeCopy(marks),
      measures: Object.freeze([...measures]),
    });

  return Object.freeze({
    mark,
    measure,
    snapshot,
  });
};

export const createRealtimeEventBus = ({
  id = "realtime-event-bus",
  capacity = 256,
  clock = nowIso,
} = {}) => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(
      "createRealtimeEventBus requires a positive integer capacity",
    );
  }
  let events = Object.freeze([]);

  const publish = (event) => {
    const nextEvent = freezeCopy({
      ...event,
      busId: id,
      timestamp: event?.timestamp || clock(),
    });
    events = Object.freeze([...events, nextEvent].slice(-capacity));
    return nextEvent;
  };

  const snapshot = () =>
    freezeCopy({
      id,
      capacity,
      events: Object.freeze([...events]),
    });

  const drain = () => {
    const drained = Object.freeze([...events]);
    events = Object.freeze([]);
    return drained;
  };

  return Object.freeze({
    id,
    kind: "realtime-event-bus",
    capacity,
    publish,
    push: publish,
    snapshot,
    drain,
  });
};

export const createRealtimeBargeInGate = () => {
  let speaking = false;
  let interrupted = false;

  const startSpeaking = () => {
    speaking = true;
    interrupted = false;
    return state();
  };

  const finishSpeaking = () => {
    speaking = false;
    return state();
  };

  const observeSttPartial = (text) => {
    const shouldInterrupt = speaking && String(text || "").trim().length > 0;
    if (shouldInterrupt) {
      interrupted = true;
    }
    return shouldInterrupt;
  };

  const observeSttEvent = (event) =>
    event?.type === "stt.partial"
      ? observeSttPartial(event.delta || event.text || "")
      : false;

  const state = () =>
    freezeCopy({
      speaking,
      interrupted,
    });

  return Object.freeze({
    startSpeaking,
    finishSpeaking,
    observeSttEvent,
    observeSttPartial,
    state,
  });
};

export const createJavascriptRealtimeCore = ({
  id = "javascript-realtime-core",
  eventCapacity = 256,
  clock = () => Date.now(),
  timestamp = nowIso,
} = {}) => {
  const eventBus = createRealtimeEventBus({
    id: `${id}:events`,
    capacity: eventCapacity,
    clock: timestamp,
  });
  const latency = createRealtimeLatencyTracker({ clock });
  const bargeIn = createRealtimeBargeInGate();

  return Object.freeze({
    id,
    kind: "realtime-core",
    implementation: "javascript",
    capabilities: Object.freeze([
      "event-bus",
      "latency",
      "barge-in",
      "device-command-contract",
    ]),
    publish: eventBus.publish,
    push: eventBus.publish,
    drain: eventBus.drain,
    mark: latency.mark,
    measure: latency.measure,
    startSpeaking: bargeIn.startSpeaking,
    finishSpeaking: bargeIn.finishSpeaking,
    shouldInterrupt: bargeIn.observeSttEvent,
    snapshot() {
      return freezeCopy({
        id,
        implementation: "javascript",
        events: eventBus.snapshot().events,
        latency: latency.snapshot(),
        bargeIn: bargeIn.state(),
      });
    },
  });
};

const rustRealtimeCoreEventKindCode = (event) => {
  const eventType = event?.type || "";
  if (eventType === "audio.received" || eventType === "realtime.listening") {
    return 0;
  }
  if (eventType === "stt.partial") {
    return 1;
  }
  if (eventType === "stt.final") {
    return 2;
  }
  if (eventType === "llm.first_token") {
    return 3;
  }
  if (eventType === "tts.first_audio") {
    return 4;
  }
  if (eventType === "tts.audio") {
    return 5;
  }
  if (eventType === "tts.interrupted" || eventType === "realtime.interrupted") {
    return 6;
  }
  if (eventType === "realtime.barge_in") {
    return 8;
  }
  return 7;
};

const rustRealtimeCoreCabiExports = (candidate) =>
  candidate?.exports || candidate?.instance?.exports || candidate;

const isRustRealtimeCoreCabi = (candidate) => {
  const exports = rustRealtimeCoreCabiExports(candidate);
  return (
    typeof exports?.iroharness_realtime_core_new === "function" &&
    typeof exports?.iroharness_realtime_core_publish === "function" &&
    typeof exports?.iroharness_realtime_core_events_len === "function"
  );
};

export const createRustRealtimeCoreCabiAdapter = ({
  id = "rust-realtime-core-cabi",
  exports,
  handle = null,
  eventCapacity = 256,
  implementation = "rust-cabi",
  clock = () => Date.now(),
  timestamp = nowIso,
} = {}) => {
  const nativeExports = rustRealtimeCoreCabiExports(exports);
  if (!isRustRealtimeCoreCabi(nativeExports)) {
    throw new Error(
      "createRustRealtimeCoreCabiAdapter requires iroharness realtime core C ABI exports",
    );
  }

  const nativeHandle =
    handle === null
      ? nativeExports.iroharness_realtime_core_new(eventCapacity)
      : handle;
  const latency = createRealtimeLatencyTracker({ clock });
  let events = Object.freeze([]);
  let closed = false;

  const assertOpen = () => {
    if (closed) {
      throw new Error(`Rust realtime core C ABI adapter is closed: ${id}`);
    }
  };

  const interrupted = () =>
    typeof nativeExports.iroharness_realtime_core_interrupted === "function"
      ? Boolean(
          nativeExports.iroharness_realtime_core_interrupted(nativeHandle),
        )
      : false;

  const publish = (event) => {
    assertOpen();
    const nativeSequence = nativeExports.iroharness_realtime_core_publish(
      nativeHandle,
      rustRealtimeCoreEventKindCode(event),
    );
    const nextEvent = freezeCopy({
      ...event,
      busId: id,
      timestamp: event?.timestamp || timestamp(),
      nativeSequence: Number(nativeSequence),
    });
    events = Object.freeze([...events, nextEvent].slice(-eventCapacity));
    return nextEvent;
  };

  return Object.freeze({
    id,
    kind: "realtime-core",
    implementation,
    capabilities: Object.freeze([
      "event-bus",
      "barge-in",
      "latency",
      "native-cabi",
      "wasm-cabi",
    ]),
    publish,
    push: publish,
    drain() {
      assertOpen();
      const drained = Object.freeze([...events]);
      events = Object.freeze([]);
      return drained;
    },
    mark: latency.mark,
    measure: latency.measure,
    startSpeaking() {
      assertOpen();
      if (
        typeof nativeExports.iroharness_realtime_core_start_speaking ===
        "function"
      ) {
        nativeExports.iroharness_realtime_core_start_speaking(nativeHandle);
      }
      return freezeCopy({ speaking: true, interrupted: false });
    },
    finishSpeaking() {
      assertOpen();
      if (
        typeof nativeExports.iroharness_realtime_core_finish_speaking ===
        "function"
      ) {
        nativeExports.iroharness_realtime_core_finish_speaking(nativeHandle);
      }
      return freezeCopy({ speaking: false, interrupted: interrupted() });
    },
    shouldInterrupt(event) {
      assertOpen();
      if (event?.type !== "stt.partial") {
        return false;
      }
      if (
        typeof nativeExports.iroharness_realtime_core_observe_stt_partial_len !==
        "function"
      ) {
        return false;
      }
      const text = String(event.delta || event.text || "");
      return Boolean(
        nativeExports.iroharness_realtime_core_observe_stt_partial_len(
          nativeHandle,
          text.trim().length,
        ),
      );
    },
    snapshot() {
      assertOpen();
      return freezeCopy({
        id,
        implementation,
        native: freezeCopy({
          eventsLen: Number(
            nativeExports.iroharness_realtime_core_events_len(nativeHandle),
          ),
          interrupted: interrupted(),
        }),
        events: Object.freeze([...events]),
        latency: latency.snapshot(),
        bargeIn: freezeCopy({
          interrupted: interrupted(),
        }),
      });
    },
    close() {
      if (
        !closed &&
        handle === null &&
        typeof nativeExports.iroharness_realtime_core_free === "function"
      ) {
        nativeExports.iroharness_realtime_core_free(nativeHandle);
      }
      closed = true;
      return freezeCopy({ id, closed });
    },
  });
};

const createNativeRealtimeCoreFacade = ({ core, id, implementation }) =>
  Object.freeze({
    id: core.id || id,
    kind: "realtime-core",
    implementation: core.implementation || implementation,
    capabilities: freezeArray(core.capabilities || []),
    publish(event) {
      if (typeof core.publish === "function") {
        return core.publish(event);
      }
      if (typeof core.push === "function") {
        return core.push(event);
      }
      return event;
    },
    push(event) {
      if (typeof core.publish === "function") {
        return core.publish(event);
      }
      if (typeof core.push === "function") {
        return core.push(event);
      }
      return event;
    },
    drain() {
      return typeof core.drain === "function"
        ? core.drain()
        : Object.freeze([]);
    },
    mark(name, at) {
      return typeof core.mark === "function" ? core.mark(name, at) : null;
    },
    measure(name, startMark, endMark) {
      return typeof core.measure === "function"
        ? core.measure(name, startMark, endMark)
        : null;
    },
    startSpeaking() {
      return typeof core.startSpeaking === "function"
        ? core.startSpeaking()
        : null;
    },
    finishSpeaking() {
      return typeof core.finishSpeaking === "function"
        ? core.finishSpeaking()
        : null;
    },
    shouldInterrupt(event) {
      if (typeof core.shouldInterrupt === "function") {
        return core.shouldInterrupt(event);
      }
      if (typeof core.observeSttEvent === "function") {
        return core.observeSttEvent(event);
      }
      if (
        event?.type === "stt.partial" &&
        typeof core.observeSttPartial === "function"
      ) {
        return core.observeSttPartial(event.delta || event.text || "");
      }
      return false;
    },
    snapshot() {
      return typeof core.snapshot === "function"
        ? core.snapshot()
        : freezeCopy({
            id: core.id || id,
            implementation: core.implementation || implementation,
          });
    },
  });

export const createRustRealtimeCoreBinding = ({
  id = "rust-realtime-core",
  native = null,
  loadNative = null,
  fallback = true,
  fallbackCore = null,
} = {}) => {
  let resolved = null;

  const resolve = () => {
    if (resolved) {
      return resolved;
    }
    const loaded =
      native || (typeof loadNative === "function" ? loadNative() : null);
    const core = isRustRealtimeCoreCabi(loaded)
      ? createRustRealtimeCoreCabiAdapter({
          id,
          exports: loaded,
          implementation: loaded?.implementation || "rust-cabi",
        })
      : typeof loaded?.createRealtimeCore === "function"
        ? loaded.createRealtimeCore({ id })
        : loaded;
    if (core) {
      resolved = createNativeRealtimeCoreFacade({
        core,
        id,
        implementation: "rust",
      });
      return resolved;
    }
    if (!fallback) {
      throw new Error(`Rust realtime core is not available: ${id}`);
    }
    resolved =
      fallbackCore ||
      createJavascriptRealtimeCore({
        id: `${id}:javascript-fallback`,
      });
    return resolved;
  };

  return Object.freeze({
    id,
    kind: "realtime-core-binding",
    implementation: "rust-optional",
    resolve,
    publish(event) {
      return resolve().publish(event);
    },
    push(event) {
      return resolve().publish(event);
    },
    drain() {
      return resolve().drain();
    },
    mark(name, at) {
      return resolve().mark(name, at);
    },
    measure(name, startMark, endMark) {
      return resolve().measure(name, startMark, endMark);
    },
    startSpeaking() {
      return resolve().startSpeaking();
    },
    finishSpeaking() {
      return resolve().finishSpeaking();
    },
    shouldInterrupt(event) {
      return resolve().shouldInterrupt(event);
    },
    snapshot() {
      return resolve().snapshot();
    },
  });
};

export const createTextStreamingStt = ({ id = "text-streaming-stt" } = {}) =>
  Object.freeze({
    id,
    kind: "stt",
    capabilities: Object.freeze([
      "streaming-stt",
      "partial-transcript",
      "final-transcript",
    ]),
    start({ onEvent = () => {} } = {}) {
      let text = "";
      let sequence = 0;
      let closed = false;

      const emit = (event) => {
        const nextEvent = freezeCopy({
          ...event,
          adapterId: id,
          sequence,
          timestamp: nowIso(),
        });
        sequence += 1;
        onEvent(nextEvent);
        return nextEvent;
      };

      return Object.freeze({
        push(chunk) {
          if (closed) {
            throw new Error(`${id} STT session is closed`);
          }
          const nextText =
            typeof chunk === "string"
              ? chunk
              : chunk?.text || chunk?.transcript || "";
          text = `${text}${nextText}`;
          return emit({
            type: chunk?.final ? "stt.final" : "stt.partial",
            text,
            delta: nextText,
            final: Boolean(chunk?.final),
          });
        },
        end() {
          if (closed) {
            return null;
          }
          closed = true;
          return emit({
            type: "stt.final",
            text,
            delta: "",
            final: true,
          });
        },
        cancel(reason = "cancelled") {
          if (closed) {
            return null;
          }
          closed = true;
          return emit({
            type: "stt.cancelled",
            text,
            reason,
            final: false,
          });
        },
      });
    },
  });

const createRealtimeAdapterEvent = ({ id, sequence, event, extra = {} }) =>
  freezeCopy({
    ...event,
    ...extra,
    adapterId: id,
    sequence,
    timestamp: nowIso(),
  });

const parseHttpRealtimePayload = async ({ response, label }) => {
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${responseText}`);
  }
  return responseText.trim() ? JSON.parse(responseText) : {};
};

export const createHttpStreamingStt = ({
  id = "http-streaming-stt",
  endpoint,
  headers = {},
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!endpoint) {
    throw new Error("createHttpStreamingStt requires endpoint");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createHttpStreamingStt requires fetchImpl");
  }
  return Object.freeze({
    id,
    kind: "stt",
    capabilities: Object.freeze([
      "streaming-stt",
      "partial-transcript",
      "final-transcript",
      "http-provider",
    ]),
    start({ onEvent = () => {} } = {}) {
      let sequence = 0;
      let closed = false;
      const emit = (event) => {
        const nextEvent = createRealtimeAdapterEvent({ id, sequence, event });
        sequence += 1;
        onEvent(nextEvent);
        return nextEvent;
      };
      const post = async (payload) => {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(payload),
        });
        const body = await parseHttpRealtimePayload({
          response,
          label: `HTTP STT ${id}`,
        });
        const events = Array.isArray(body.events)
          ? body.events
          : [
              {
                type: body.final ? "stt.final" : "stt.partial",
                text: body.text || body.transcript || "",
                delta: body.delta || body.text || body.transcript || "",
                final: Boolean(body.final),
              },
            ];
        return Object.freeze(events.map((event) => emit(event)));
      };
      return Object.freeze({
        async push(chunk) {
          if (closed) {
            throw new Error(`${id} STT session is closed`);
          }
          return post({
            type: "audio",
            audio: chunk?.audio || chunk?.data || null,
            text: typeof chunk === "string" ? chunk : chunk?.text || null,
            final: Boolean(chunk?.final),
          });
        },
        async end() {
          if (closed) {
            return Object.freeze([]);
          }
          closed = true;
          return post({ type: "end", final: true });
        },
        cancel(reason = "cancelled") {
          if (closed) {
            return null;
          }
          closed = true;
          return emit({
            type: "stt.cancelled",
            text: "",
            reason,
            final: false,
          });
        },
      });
    },
  });
};

export const createTextStreamingTts = ({
  id = "text-streaming-tts",
  chunkSize = 24,
} = {}) =>
  Object.freeze({
    id,
    kind: "tts",
    capabilities: Object.freeze([
      "streaming-tts",
      "audio-chunks",
      "interruptible",
    ]),
    async stream({
      text,
      voice = null,
      onEvent = () => {},
      signal = null,
    } = {}) {
      const chunks = [];
      const source = String(text || "");
      let sequence = 0;

      const emit = (event) => {
        const nextEvent = freezeCopy({
          ...event,
          adapterId: id,
          voice,
          sequence,
          timestamp: nowIso(),
        });
        sequence += 1;
        onEvent(nextEvent);
        chunks.push(nextEvent);
        return nextEvent;
      };

      for (let index = 0; index < source.length; index += chunkSize) {
        if (signal?.aborted) {
          emit({
            type: "tts.interrupted",
            text: source.slice(0, index),
            reason: signal.reason || "aborted",
          });
          return Object.freeze(chunks);
        }
        const chunkText = source.slice(index, index + chunkSize);
        emit({
          type: "tts.audio",
          text: chunkText,
          audio: chunkText,
          final: false,
        });
      }

      emit({
        type: "tts.completed",
        text: source,
        audio: "",
        final: true,
      });
      return Object.freeze(chunks);
    },
  });

export const createHttpStreamingTts = ({
  id = "http-streaming-tts",
  endpoint,
  headers = {},
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!endpoint) {
    throw new Error("createHttpStreamingTts requires endpoint");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createHttpStreamingTts requires fetchImpl");
  }
  return Object.freeze({
    id,
    kind: "tts",
    capabilities: Object.freeze([
      "streaming-tts",
      "audio-chunks",
      "interruptible",
      "http-provider",
    ]),
    async stream({
      text,
      voice = null,
      onEvent = () => {},
      signal = null,
    } = {}) {
      const chunks = [];
      let sequence = 0;
      const emit = (event) => {
        const nextEvent = createRealtimeAdapterEvent({
          id,
          sequence,
          event,
          extra: { voice },
        });
        sequence += 1;
        onEvent(nextEvent);
        chunks.push(nextEvent);
        return nextEvent;
      };
      if (signal?.aborted) {
        emit({
          type: "tts.interrupted",
          text: String(text || ""),
          reason: signal.reason || "aborted",
        });
        return Object.freeze(chunks);
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          text: String(text || ""),
          voice,
        }),
        signal,
      });
      const body = await parseHttpRealtimePayload({
        response,
        label: `HTTP TTS ${id}`,
      });
      const events = Array.isArray(body.events)
        ? body.events
        : Array.isArray(body.chunks)
          ? body.chunks.map((chunk) => ({
              type: "tts.audio",
              text: chunk.text || "",
              audio: chunk.audio || chunk.data || chunk,
              final: false,
            }))
          : [
              {
                type: "tts.audio",
                text: String(text || ""),
                audio: body.audio || body.data || "",
                final: false,
              },
              {
                type: "tts.completed",
                text: String(text || ""),
                audio: "",
                final: true,
              },
            ];
      events.forEach((event) => {
        if (!signal?.aborted) {
          emit(event);
        }
      });
      if (signal?.aborted && chunks.at(-1)?.type !== "tts.interrupted") {
        emit({
          type: "tts.interrupted",
          text: String(text || ""),
          reason: signal.reason || "aborted",
        });
      }
      if (!signal?.aborted && chunks.at(-1)?.type !== "tts.completed") {
        emit({
          type: "tts.completed",
          text: String(text || ""),
          audio: "",
          final: true,
        });
      }
      return Object.freeze(chunks);
    },
  });
};

export const createSpeechPlaybackQueue = ({
  id = "speech-playback-queue",
  maxSize = 32,
  onEvent = () => {},
} = {}) => {
  const pending = [];
  const history = [];
  let sequence = 0;
  let current = null;
  let itemSequence = 0;

  const emit = (event) => {
    const nextEvent = freezeCopy({
      ...event,
      queueId: id,
      sequence,
      timestamp: nowIso(),
    });
    sequence += 1;
    history.push(nextEvent);
    onEvent(nextEvent);
    return nextEvent;
  };

  const normalizeItem = (item) =>
    freezeCopy({
      id: item?.id || `${id}:speech:${itemSequence}`,
      text: String(item?.text || ""),
      audio: item?.audio || null,
      voice: item?.voice || null,
      source: item?.source || "macro-harness",
      priority: Number.isFinite(item?.priority) ? item.priority : 0,
      metadata: freezeCopy(item?.metadata || {}),
    });

  const startNext = () => {
    if (current || pending.length === 0) {
      return current;
    }
    current = pending.shift();
    emit({
      type: "speech.started",
      item: current,
      pendingCount: pending.length,
    });
    return current;
  };

  return Object.freeze({
    id,
    kind: "speech-playback-queue",
    enqueue(item = {}, { mode = "append", autoplay = true } = {}) {
      if (mode === "replace") {
        this.interrupt("replaced", { clearPending: true });
      }
      if (pending.length >= maxSize) {
        throw new Error(`${id} playback queue is full`);
      }
      const nextItem = normalizeItem(item);
      itemSequence += 1;
      const insertAt = pending.findIndex(
        (entry) => entry.priority < nextItem.priority,
      );
      if (insertAt === -1) {
        pending.push(nextItem);
      } else {
        pending.splice(insertAt, 0, nextItem);
      }
      emit({
        type: "speech.queued",
        item: nextItem,
        pendingCount: pending.length,
      });
      if (autoplay) {
        startNext();
      }
      return nextItem;
    },
    startNext,
    complete(itemId = current?.id) {
      if (!current || current.id !== itemId) {
        return null;
      }
      const completed = current;
      current = null;
      const event = emit({
        type: "speech.completed",
        item: completed,
        pendingCount: pending.length,
      });
      startNext();
      return event;
    },
    interrupt(reason = "interrupted", { clearPending = false } = {}) {
      const interrupted = current;
      current = null;
      if (clearPending) {
        pending.splice(0, pending.length);
      }
      if (!interrupted) {
        return null;
      }
      return emit({
        type: "speech.interrupted",
        item: interrupted,
        reason,
        pendingCount: pending.length,
      });
    },
    clear(reason = "cleared") {
      const clearedCount = pending.length + (current ? 1 : 0);
      pending.splice(0, pending.length);
      current = null;
      return emit({
        type: "speech.cleared",
        reason,
        clearedCount,
        pendingCount: 0,
      });
    },
    snapshot() {
      return freezeCopy({
        id,
        kind: "speech-playback-queue",
        current,
        pending,
        events: history,
      });
    },
  });
};

export const createRealtimeVoiceSession = ({
  id = "realtime-voice-session",
  stt = createTextStreamingStt(),
  tts = createTextStreamingTts(),
  latency = createRealtimeLatencyTracker(),
  realtimeCore = null,
  onEvent = () => {},
} = {}) => {
  let activeTts = null;
  let speaking = false;
  let interruptedCount = 0;
  let sttSession = null;

  const emit = (event) => {
    const nextEvent = freezeCopy({
      ...event,
      sessionId: id,
      timestamp: nowIso(),
    });
    realtimeCore?.publish?.(nextEvent);
    onEvent(nextEvent);
    return nextEvent;
  };

  const markLatency = (name) => {
    const mark = latency.mark(name);
    realtimeCore?.mark?.(name, mark.at);
    return mark;
  };

  const interrupt = (reason = "barge-in") => {
    if (!activeTts || activeTts.signal.aborted) {
      return null;
    }
    interruptedCount += 1;
    activeTts.abort(reason);
    return emit({
      type: "realtime.barge_in",
      reason,
      interruptedCount,
    });
  };

  const handleSttEvent = (event) => {
    const nextEvent = emit(event);
    if (
      speaking &&
      (realtimeCore?.shouldInterrupt?.(event) ||
        (event.type === "stt.partial" &&
          String(event.delta || event.text || "").trim()))
    ) {
      interrupt("barge-in");
    }
    if (event.type === "stt.final") {
      markLatency("stt.final");
    }
    return nextEvent;
  };

  const listen = () => {
    markLatency("audio.received");
    sttSession = stt.start({
      onEvent: handleSttEvent,
    });
    emit({
      type: "realtime.listening",
      sttId: stt.id,
    });
    return sttSession;
  };

  const speak = async ({ text, voice = null } = {}) => {
    if (activeTts && !activeTts.signal.aborted) {
      interrupt("superseded");
    }
    const controller = new AbortController();
    activeTts = controller;
    speaking = true;
    realtimeCore?.startSpeaking?.();
    markLatency("tts.start");
    emit({
      type: "realtime.speaking",
      ttsId: tts.id,
      voice,
    });
    const chunks = await tts.stream({
      text,
      voice,
      signal: controller.signal,
      onEvent(event) {
        if (
          event.type === "tts.audio" &&
          !latency.snapshot().marks["tts.first_audio"]
        ) {
          markLatency("tts.first_audio");
        }
        emit(event);
      },
    });
    speaking = false;
    realtimeCore?.finishSpeaking?.();
    if (activeTts === controller) {
      activeTts = null;
    }
    emit({
      type:
        chunks.at(-1)?.type === "tts.interrupted"
          ? "realtime.interrupted"
          : "realtime.spoken",
      ttsId: tts.id,
      chunkCount: chunks.length,
    });
    return Object.freeze(chunks);
  };

  const close = (reason = "closed") => {
    interrupt(reason);
    sttSession?.cancel?.(reason);
    sttSession = null;
    speaking = false;
    emit({
      type: "realtime.closed",
      reason,
    });
  };

  return Object.freeze({
    id,
    listen,
    speak,
    interrupt,
    handleSttEvent,
    latency: () => latency.snapshot(),
    state() {
      return freezeCopy({
        speaking,
        listening: Boolean(sttSession),
        interruptedCount,
      });
    },
    close,
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
        artifacts: Object.freeze([]),
      });
    },
  });

export const createRecorderStreamController = (id = "stream-controller") => {
  let actions = [];
  return Object.freeze({
    id,
    capabilities: Object.freeze(["scene", "overlay", "mute", "stream"]),
    async execute({ input, route, actor }) {
      const action = freezeCopy({
        id: createId("stream_action"),
        controllerId: id,
        text: input.text,
        route,
        actorUserId: actor.user.id,
        streamSessionId: input.metadata?.streamSessionId || null,
        createdAt: nowIso(),
      });
      actions = Object.freeze([...actions, action]);
      return freezeCopy({
        status: "completed",
        summary: `${id} accepted stream action: ${input.text.slice(0, 80)}`,
        action,
        artifacts: Object.freeze([]),
      });
    },
    actions() {
      return Object.freeze([...actions]);
    },
  });
};

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
    },
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
    },
  });

// member/public/anonymous and any unrecognized tier fall through to "public" (fail closed).
const SKILL_TIER_VIEW = Object.freeze({
  owner: "owner",
  trusted: "trusted",
  operator: "trusted",
});

const tierToView = (tier) => SKILL_TIER_VIEW[tier] || "public";

export const createIroHarness = ({
  character,
  projectOs,
  userRegistry = createInMemoryUserRegistry(),
  permissionPolicy = createPermissionPolicy(),
  audiencePolicy = createAudienceContextPolicy(),
  router = createHeuristicRouter(),
  brains,
  devices = [],
  microHarnesses = [],
  streamController = null,
  skills = null,
  hooks = null,
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
  const brainSummary = () =>
    Object.freeze(
      [
        ["voice", brains.voice],
        ["text", brains.text],
        ["deep", brains.deep],
      ]
        .filter(([, brain]) => Boolean(brain))
        .map(([slot, brain]) =>
          freezeCopy({
            slot,
            id: brain.id || slot,
          }),
        ),
    );

  let state = createCharacterState({
    characterId: character.id,
    mode: MODES.idle,
    emotion: DEFAULT_EMOTION,
  });

  const emit = (event) => {
    devices.forEach((device) => device.emit(event));
  };

  const setState = (nextState) => {
    state = createCharacterState({
      characterId: character.id,
      ...nextState,
    });
    emit({
      type: "state",
      state,
      timestamp: nowIso(),
    });
    return state;
  };

  const receive = async (input) => {
    if (!input || !input.text || !input.modality || !input.source) {
      throw new Error(
        "input.source, input.modality, and input.text are required",
      );
    }
    const actor = await userRegistry.resolveActor(input.actor || {});

    setState({
      mode: MODES.thinking,
      emotion: "focused",
      speechText: null,
      mouth: "closed",
      motion: MODES.thinking,
    });

    const route = router.choose({
      input,
      character,
      actor,
      microHarnesses,
    });
    const contextScopes =
      typeof permissionPolicy.createContextScopes === "function"
        ? permissionPolicy.createContextScopes(input)
        : Object.freeze(["global"]);
    const actorPermissions =
      typeof permissionPolicy.permissionsFor === "function"
        ? permissionPolicy.permissionsFor(actor.user, contextScopes)
        : Object.freeze([]);
    const audience = audiencePolicy.resolve({
      actor,
      route,
      input,
      permissions: actorPermissions,
      contextScopes,
    });

    if (hooks) {
      const turnResult = hooks.dispatch(
        "turn:before",
        { input, actor, audience, route },
        { protectedKeys: ["actor"] },
      );
      if (turnResult.blocked) {
        return rejectByHook(input, route, actor, audience, turnResult.reason);
      }
      input = turnResult.context.input ?? input;
    }

    const permission = permissionPolicy.evaluate({
      user: actor.user,
      route,
      input,
    });
    if (!permission.allowed) {
      return rejectByPermission(input, route, actor, permission, audience);
    }

    if (route.kind === "work" && route.harnessId) {
      return runMicroHarness(
        input,
        route,
        actor,
        audience,
        permission,
        actorPermissions,
        contextScopes,
      );
    }

    if (route.kind === "stream") {
      return runStreamController(input, route, actor, audience);
    }

    const brain =
      route.kind === "voice"
        ? brains.voice
        : route.kind === "deep"
          ? brains.deep || brains.text
          : brains.text;
    const skillListing = skills
      ? createSkillContextListing({
          // skills.list() re-scans the skill directory each turn; acceptable for local FS at this scale.
          skills: gateSkills({
            skills: skills.list(),
            view: tierToView(audience.tier),
            permissions: actorPermissions,
          }),
        })
      : Object.freeze([]);
    const response = await brain.respond({
      character,
      input,
      actor,
      audience,
      route,
      state,
      projectOs: projectOs.snapshot(),
      skills: skillListing,
    });

    setState({
      mode: MODES.speaking,
      emotion: response.emotion || "attentive",
      speechText: response.text,
      mouth: "talking",
      motion: MODES.speaking,
    });
    emit({
      type: "speech",
      text: response.text,
      modality: input.modality,
      brainId: brain.id,
      timestamp: nowIso(),
    });
    setState({
      mode: MODES.idle,
      emotion: response.emotion || "attentive",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle,
    });

    return freezeCopy({
      kind: "response",
      route,
      actor,
      audience,
      text: response.text,
      brainId: brain.id,
    });
  };

  const rejectByHook = (input, route, actor, audience, reason) => {
    const text = "そのお願いは今は受けられないよ。";
    setState({
      mode: MODES.speaking,
      emotion: "careful",
      speechText: text,
      mouth: "talking",
      motion: MODES.speaking,
    });
    emit({
      type: "speech",
      text,
      modality: input.modality,
      brainId: "hook-policy",
      timestamp: nowIso(),
    });
    setState({
      mode: MODES.idle,
      emotion: "careful",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle,
    });
    return freezeCopy({
      kind: "hook_denied",
      route,
      actor,
      audience,
      reason: reason ?? null,
      text,
    });
  };

  const rejectByPermission = async (
    input,
    route,
    actor,
    permission,
    audience,
  ) => {
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
        actorUserId: actor.user.id,
      },
    });
    emit({
      type: "speech",
      text,
      modality: input.modality,
      brainId: "permission-policy",
      timestamp: nowIso(),
    });
    setState({
      mode: MODES.idle,
      emotion: "careful",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle,
      metadata: {
        permission: permission.permission,
        actorUserId: actor.user.id,
      },
    });
    return freezeCopy({
      kind: "permission_denied",
      route,
      actor,
      audience,
      permission,
      text,
    });
  };

  const runMicroHarness = async (
    input,
    route,
    actor,
    audience,
    permission,
    actorPermissions,
    contextScopes,
  ) => {
    const microHarness = microHarnesses.find(
      (candidate) => candidate.id === route.harnessId,
    );
    if (!microHarness) {
      throw new Error(`Micro harness not found: ${route.harnessId}`);
    }
    const permissionCheck = freezeCopy({
      allowed: permission.allowed,
      permission: permission.permission || "delegate_work",
      reason: permission.reason,
      actorPermissions,
      contextScopes,
    });

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
        actorPlatformUserId: actor.identity.platformUserId,
        permissionCheck,
      },
    });

    setState({
      mode: MODES.working,
      emotion: "focused",
      speechText: "見てみるね。",
      taskRef: ticket.id,
      mouth: "talking",
      motion: MODES.working,
    });
    emit({
      type: "speech",
      text: "見てみるね。",
      modality: input.modality,
      brainId: "macro-reflex",
      timestamp: nowIso(),
    });
    emit({
      type: "task",
      status: "started",
      ticketId: ticket.id,
      harnessId: microHarness.id,
      timestamp: nowIso(),
    });

    const run = projectOs.createRun({
      ticketId: ticket.id,
      harnessId: microHarness.id,
      input: {
        ...input,
        permissionCheck,
      },
    });
    const output = await microHarness.run(ticket, {
      character,
      actor,
      audience,
      input,
      projectOs: projectOs.snapshot(),
    });
    const completedRun = projectOs.completeRun(run.id, output, output.status);
    const artifacts = Array.isArray(output.artifacts)
      ? output.artifacts.map((artifact) =>
          projectOs.addArtifact({
            ticketId: ticket.id,
            runId: run.id,
            kind: artifact.kind || "generic",
            uri: artifact.uri || "",
            title: artifact.title || artifact.uri || "artifact",
          }),
        )
      : [];
    projectOs.updateTicket(ticket.id, {
      status: output.status === "completed" ? "done" : "needs_attention",
    });

    emit({
      type: "task",
      status: output.status,
      ticketId: ticket.id,
      runId: run.id,
      harnessId: microHarness.id,
      summary: output.summary,
      timestamp: nowIso(),
    });
    setState({
      mode: MODES.idle,
      emotion: "relieved",
      speechText: null,
      taskRef: ticket.id,
      mouth: "closed",
      motion: MODES.idle,
    });

    return freezeCopy({
      kind: "delegation",
      route,
      actor,
      audience,
      ticket,
      run: completedRun,
      output,
      artifacts: Object.freeze(artifacts),
    });
  };

  const runStreamController = async (input, route, actor, audience) => {
    if (!streamController || typeof streamController.execute !== "function") {
      const text = "配信操作の接続がまだ設定されていないよ。";
      setState({
        mode: MODES.speaking,
        emotion: "careful",
        speechText: text,
        mouth: "talking",
        motion: MODES.speaking,
      });
      emit({
        type: "speech",
        text,
        modality: input.modality,
        brainId: "stream-controller",
        timestamp: nowIso(),
      });
      setState({
        mode: MODES.idle,
        emotion: "careful",
        speechText: null,
        mouth: "closed",
        motion: MODES.idle,
      });
      return freezeCopy({
        kind: "stream_unavailable",
        route,
        actor,
        audience,
        text,
      });
    }

    setState({
      mode: MODES.working,
      emotion: "focused",
      speechText: "配信まわりを確認するね。",
      mouth: "talking",
      motion: MODES.working,
      metadata: {
        actorUserId: actor.user.id,
        streamSessionId: input.metadata?.streamSessionId || null,
      },
    });
    emit({
      type: "speech",
      text: "配信まわりを確認するね。",
      modality: input.modality,
      brainId: "macro-stream-reflex",
      timestamp: nowIso(),
    });
    emit({
      type: "stream",
      status: "started",
      controllerId: streamController.id || "stream-controller",
      actorUserId: actor.user.id,
      streamSessionId: input.metadata?.streamSessionId || null,
      timestamp: nowIso(),
    });

    const output = await streamController.execute({
      character,
      input,
      route,
      actor,
      audience,
      projectOs: projectOs.snapshot(),
    });

    emit({
      type: "stream",
      status: output.status || "completed",
      controllerId: streamController.id || "stream-controller",
      actorUserId: actor.user.id,
      streamSessionId: input.metadata?.streamSessionId || null,
      summary: output.summary,
      timestamp: nowIso(),
    });
    setState({
      mode: MODES.idle,
      emotion: output.status === "failed" ? "careful" : "relieved",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle,
    });

    return freezeCopy({
      kind: "stream_operation",
      route,
      actor,
      audience,
      output,
    });
  };

  return Object.freeze({
    character: freezeCopy(character),
    receive,
    state: () => state,
    brains: brainSummary,
    projectOs: () => projectOs.snapshot(),
    users: () => userRegistry.snapshot(),
  });
};

export const constants = Object.freeze({
  MODES,
});
