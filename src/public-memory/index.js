// Public-memory banks for IroHarness public-mode operation.
//
// The character keeps four memory drawers under public mode:
//
//   - private_long_term  : the character's full long-term memory (closed).
//   - private_user       : users-memory/*.md style per-user notes (closed).
//   - public_long_term   : durable, human-approved facts safe for any viewer.
//   - public_stream_log  : raw episodic log of what happened on a public
//                          surface, kept *separate* from the private banks
//                          so promotion to long-term is an explicit step.
//
// "Closed" here means *unreachable*, not "encrypted": the public-mode runtime
// never receives a handle to the private banks. This module owns the
// in-memory implementation of the public drawers and a routed facade
// (`createPublicMemoryFacade`) that the runtime can hand to the brain in
// place of a single combined memory.

const freezeCopy = (value) => Object.freeze({ ...value });
const freezeArray = (value = []) => Object.freeze([...value]);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const nowIso = () => new Date().toISOString();

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// createInMemoryPublicMemoryBank
//
// A bounded append-only log. Older entries fall off when the bank exceeds
// `maxEntries`, which keeps the public drawers cheap to ship to a process
// restart and easy to redact in bulk.
// ---------------------------------------------------------------------------

export const createInMemoryPublicMemoryBank = ({
  id,
  kind,
  maxEntries = 500
} = {}) => {
  if (!isNonEmptyString(id)) {
    throw new Error("public memory bank id is required");
  }
  if (!isNonEmptyString(kind)) {
    throw new Error("public memory bank kind is required");
  }
  let entries = [];

  const append = (entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("public memory entry must be an object");
    }
    const stored = freezeCopy({
      id: entry.id || createId(kind),
      kind,
      text: typeof entry.text === "string" ? entry.text : "",
      tags: freezeArray(entry.tags || []),
      actorHash: entry.actorHash || null,
      platform: entry.platform || null,
      surface: entry.surface || null,
      streamSessionId: entry.streamSessionId || null,
      metadata: freezeCopy(entry.metadata || {}),
      createdAt: entry.createdAt || nowIso(),
      approvedBy: entry.approvedBy || null
    });
    entries = [...entries, stored];
    if (entries.length > maxEntries) {
      entries = entries.slice(entries.length - maxEntries);
    }
    return stored;
  };

  const remove = (predicate) => {
    if (typeof predicate !== "function") {
      throw new Error("predicate must be a function");
    }
    const before = entries.length;
    entries = entries.filter((entry) => !predicate(entry));
    return before - entries.length;
  };

  const list = (filter = {}) => {
    return freezeArray(
      entries.filter((entry) => {
        if (filter.actorHash && entry.actorHash !== filter.actorHash) return false;
        if (filter.platform && entry.platform !== filter.platform) return false;
        if (filter.streamSessionId && entry.streamSessionId !== filter.streamSessionId) {
          return false;
        }
        if (filter.tag && !entry.tags.includes(filter.tag)) return false;
        if (filter.since && entry.createdAt < filter.since) return false;
        return true;
      })
    );
  };

  return freezeCopy({
    id,
    kind,
    append,
    remove,
    list,
    snapshot: () =>
      freezeCopy({
        id,
        kind,
        size: entries.length,
        maxEntries
      })
  });
};

// ---------------------------------------------------------------------------
// createPublicMemoryFacade
//
// The runtime hands the brain only this facade. It contains the public banks,
// optional redaction, and *zero* references to private memory. The closed
// drawers report themselves as locked so observability is honest, but they
// cannot be opened from this object.
// ---------------------------------------------------------------------------

export const createPublicMemoryFacade = ({
  publicLongTerm = createInMemoryPublicMemoryBank({
    id: "public-long-term",
    kind: "public_long_term"
  }),
  publicStreamLog = createInMemoryPublicMemoryBank({
    id: "public-stream-log",
    kind: "public_stream_log"
  }),
  redactionFilter = null,
  viewerIdentityHasher = null,
  approvalRequired = true,
  onPromotion = null
} = {}) => {
  const redactString = (value) =>
    redactionFilter && typeof redactionFilter.redact === "function"
      ? redactionFilter.redact(value)
      : value;
  const redactEntry = (entry) =>
    freezeCopy({
      ...entry,
      text: redactString(entry.text || ""),
      metadata: redactionFilter && typeof redactionFilter.redactObject === "function"
        ? redactionFilter.redactObject(entry.metadata || {})
        : freezeCopy(entry.metadata || {})
    });

  const hashActor = (actor) => {
    if (!actor || !viewerIdentityHasher) return null;
    if (!actor.platform || !actor.platformUserId) return null;
    return viewerIdentityHasher.hash(actor.platform, actor.platformUserId);
  };

  const recordStreamTurn = ({ surface, platform, streamSessionId, actor, text, tags, metadata }) => {
    return publicStreamLog.append({
      surface: surface || null,
      platform: platform || null,
      streamSessionId: streamSessionId || null,
      actorHash: hashActor(actor),
      text: redactString(text || ""),
      tags: tags || [],
      metadata: redactionFilter && typeof redactionFilter.redactObject === "function"
        ? redactionFilter.redactObject(metadata || {})
        : metadata || {}
    });
  };

  const promoteToLongTerm = ({ entryId, approvedBy, text, tags, metadata }) => {
    if (approvalRequired && !isNonEmptyString(approvedBy)) {
      throw new Error("approvedBy is required for public long-term promotion");
    }
    const promoted = publicLongTerm.append({
      text: redactString(text || ""),
      tags: tags || [],
      metadata: redactionFilter && typeof redactionFilter.redactObject === "function"
        ? redactionFilter.redactObject(metadata || {})
        : metadata || {},
      approvedBy: approvedBy || null,
      streamSessionId: null
    });
    if (typeof onPromotion === "function") {
      try {
        onPromotion({ entryId: entryId || null, promotion: promoted });
      } catch {
        // observability must not throw
      }
    }
    return promoted;
  };

  const forgetActor = (actorHash) => {
    if (!isNonEmptyString(actorHash)) return 0;
    const removedLog = publicStreamLog.remove((entry) => entry.actorHash === actorHash);
    const removedLongTerm = publicLongTerm.remove((entry) => entry.actorHash === actorHash);
    return removedLog + removedLongTerm;
  };

  const recallForBrain = ({ surface, platform, streamSessionId, actor, limit = 5 } = {}) => {
    const actorHash = hashActor(actor);
    const longTerm = publicLongTerm
      .list({ platform })
      .slice(-limit)
      .map(redactEntry);
    const stream = publicStreamLog
      .list({ surface, platform, streamSessionId, actorHash })
      .slice(-limit)
      .map(redactEntry);
    return freezeCopy({
      publicLongTerm: freezeArray(longTerm),
      publicStreamLog: freezeArray(stream),
      privateLongTerm: freezeArray([]),
      privateUser: freezeArray([]),
      drawers: freezeCopy({
        private_long_term: "closed",
        private_user: "closed",
        public_long_term: "open",
        public_stream_log: "open"
      })
    });
  };

  return freezeCopy({
    recordStreamTurn,
    promoteToLongTerm,
    forgetActor,
    recallForBrain,
    snapshot: () =>
      freezeCopy({
        publicLongTerm: publicLongTerm.snapshot(),
        publicStreamLog: publicStreamLog.snapshot(),
        privateDrawersClosed: true,
        approvalRequired
      })
  });
};

export const publicMemoryConstants = freezeCopy({
  drawers: Object.freeze({
    privateLongTerm: "private_long_term",
    privateUser: "private_user",
    publicLongTerm: "public_long_term",
    publicStreamLog: "public_stream_log"
  })
});
