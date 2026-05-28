// Public-mode runtime for IroHarness.
//
// createPublicMode wires the public-safety primitives and the public-memory
// facade into one operational policy that any public surface (YouTube live
// chat, X, Bluesky, Discord public channel, OBS browser source) can ask to
// process a turn safely.
//
// The contract is intentionally narrow:
//
//   const publicMode = createPublicMode({ ... });
//   const result = await publicMode.handleTurn({ turn, sendReply });
//
// The runtime is the boundary; the brain, project OS, micro-harnesses, and
// private memory live on the *outside* and are never reachable from this
// object once it has been wired.

import {
  createKillSwitch,
  createPromptInjectionDetector,
  createRedactionFilter,
  createSafeFailureGate,
  createViewerIdentityHasher
} from "../public-safety/index.js";
import {
  createPublicMemoryFacade
} from "../public-memory/index.js";

const freezeCopy = (value) => Object.freeze({ ...value });
const freezeArray = (value = []) => Object.freeze([...value]);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const DENY_PERMISSIONS = Object.freeze([
  "delegate_work",
  "manage_stream",
  "manage_users",
  "deep_discussion"
]);

const DEFAULT_PUBLIC_PROFILE = freezeCopy({
  hidePrivateUserMemory: true,
  hidePrivateLongTermMemory: true,
  enforceRedaction: true,
  denyPermissions: DENY_PERMISSIONS,
  storeStreamLog: true,
  silentOnFailure: true
});

const isApprovedSurface = (surfaces, surface) => {
  if (!surfaces || surfaces.length === 0) return true;
  if (!isNonEmptyString(surface)) return false;
  return surfaces.includes(surface);
};

export const createPublicMode = ({
  character,
  brain,
  redactionTerms = [],
  redactionReplacement = "[REDACTED]",
  injectionDetector = createPromptInjectionDetector(),
  failureGate = createSafeFailureGate({ silentReply: null }),
  killSwitch = createKillSwitch({ initial: "running" }),
  viewerIdentityHasher = createViewerIdentityHasher({}),
  publicMemoryFacade = null,
  approvedSurfaces = [],
  publicProfile = DEFAULT_PUBLIC_PROFILE,
  onTurn = null,
  onReply = null,
  onBlocked = null
} = {}) => {
  if (!character || !character.id) {
    throw new Error("character with id is required for public mode");
  }
  if (!brain || typeof brain.respond !== "function") {
    throw new Error("brain with respond(...) is required for public mode");
  }

  const profile = freezeCopy({ ...DEFAULT_PUBLIC_PROFILE, ...publicProfile });
  const redactionFilter = createRedactionFilter({
    terms: redactionTerms,
    replacement: redactionReplacement
  });

  const memory = publicMemoryFacade
    ? publicMemoryFacade
    : createPublicMemoryFacade({
        redactionFilter,
        viewerIdentityHasher
      });

  // Public character profile: strip private long-term memory and any private
  // user notes the host may have attached to character.metadata.
  const publicCharacter = freezeCopy({
    id: character.id,
    name: character.name,
    soul: profile.hidePrivateLongTermMemory ? null : character.soul || null,
    identity: character.identity || null,
    voiceStyle: character.voiceStyle || null,
    memory: profile.hidePrivateLongTermMemory ? null : character.memory || null,
    metadata: freezeCopy({
      mode: "public",
      hidePrivateUserMemory: profile.hidePrivateUserMemory,
      hidePrivateLongTermMemory: profile.hidePrivateLongTermMemory
    })
  });

  const announceBlocked = (turn, reason, details = {}) => {
    if (typeof onBlocked === "function") {
      try {
        onBlocked({ turn, reason, details: freezeCopy(details) });
      } catch {
        // observability must not throw
      }
    }
  };

  const announceTurn = (turn) => {
    if (typeof onTurn === "function") {
      try {
        onTurn({ turn });
      } catch {
        // observability must not throw
      }
    }
  };

  const announceReply = (turn, reply) => {
    if (typeof onReply === "function") {
      try {
        onReply({ turn, reply });
      } catch {
        // observability must not throw
      }
    }
  };

  const blockedReply = (reason, details = {}) => {
    return freezeCopy({
      handled: true,
      replied: false,
      reason,
      details: freezeCopy(details)
    });
  };

  const handleTurn = async ({ turn, sendReply } = {}) => {
    if (!turn || !isNonEmptyString(turn.text)) {
      announceBlocked(turn, "invalid-turn");
      return blockedReply("invalid-turn");
    }
    if (!killSwitch.canAcceptTurn()) {
      announceBlocked(turn, "kill-switch", killSwitch.snapshot());
      return blockedReply("kill-switch", killSwitch.snapshot());
    }
    if (!isApprovedSurface(approvedSurfaces, turn.surface)) {
      announceBlocked(turn, "surface-not-approved", { surface: turn.surface });
      return blockedReply("surface-not-approved", { surface: turn.surface });
    }
    if (turn.requestedPermission && profile.denyPermissions.includes(turn.requestedPermission)) {
      announceBlocked(turn, "permission-denied-in-public", {
        requestedPermission: turn.requestedPermission
      });
      return blockedReply("permission-denied-in-public", {
        requestedPermission: turn.requestedPermission
      });
    }

    const inspection = injectionDetector.inspect(turn.text);
    if (inspection.detected) {
      failureGate.trigger("permission-error", {
        injection: true,
        matches: inspection.matches
      });
      announceBlocked(turn, "prompt-injection", { matches: inspection.matches });
      return blockedReply("prompt-injection", { matches: inspection.matches });
    }

    announceTurn(turn);

    const recall = memory.recallForBrain({
      surface: turn.surface,
      platform: turn.platform || turn.source,
      streamSessionId: turn.streamSessionId,
      actor: turn.actor
    });

    if (profile.storeStreamLog) {
      memory.recordStreamTurn({
        surface: turn.surface,
        platform: turn.platform || turn.source,
        streamSessionId: turn.streamSessionId,
        actor: turn.actor,
        text: turn.text,
        tags: ["inbound"],
        metadata: turn.metadata || {}
      });
    }

    const safeRequest = freezeCopy({
      character: publicCharacter,
      input: freezeCopy({
        source: turn.source,
        modality: turn.modality || "text",
        text: profile.enforceRedaction ? redactionFilter.redact(turn.text) : turn.text,
        surface: turn.surface || null
      }),
      memory: recall,
      mode: "public",
      profile,
      actor: freezeCopy({
        platform: turn.actor?.platform || null,
        displayName: turn.actor?.displayName || null,
        actorHash:
          turn.actor && viewerIdentityHasher && turn.actor.platform && turn.actor.platformUserId
            ? viewerIdentityHasher.hash(turn.actor.platform, turn.actor.platformUserId)
            : null
      })
    });

    const response = await failureGate.wrap("brain-error", async () => {
      const value = await brain.respond(safeRequest);
      if (!value || typeof value !== "object") {
        throw new Error("brain returned a non-object response");
      }
      return value;
    });

    if (response.silent) {
      announceBlocked(turn, "brain-failure", { reason: response.reason });
      return blockedReply("brain-failure", { reason: response.reason });
    }

    const safeText = profile.enforceRedaction
      ? redactionFilter.redact(response.text || "")
      : response.text || "";

    const safeReply = freezeCopy({
      text: safeText,
      emotion: response.emotion || "neutral"
    });

    if (profile.storeStreamLog) {
      memory.recordStreamTurn({
        surface: turn.surface,
        platform: turn.platform || turn.source,
        streamSessionId: turn.streamSessionId,
        actor: turn.actor,
        text: safeReply.text,
        tags: ["outbound"],
        metadata: { emotion: safeReply.emotion }
      });
    }

    if (typeof sendReply === "function") {
      await failureGate.wrap("brain-error", async () => sendReply(safeReply));
    }

    announceReply(turn, safeReply);
    return freezeCopy({
      handled: true,
      replied: true,
      reply: safeReply,
      memory: recall.drawers
    });
  };

  return freezeCopy({
    mode: "public",
    handleTurn,
    killSwitch,
    redactionFilter,
    publicMemory: memory,
    publicCharacter,
    profile,
    snapshot: () =>
      freezeCopy({
        character: publicCharacter,
        killSwitch: killSwitch.snapshot(),
        redaction: redactionFilter.snapshot(),
        memory: memory.snapshot(),
        approvedSurfaces: freezeArray(approvedSurfaces),
        profile
      })
  });
};

export const publicModeConstants = freezeCopy({
  defaultProfile: DEFAULT_PUBLIC_PROFILE,
  defaultDenyPermissions: DENY_PERMISSIONS
});
