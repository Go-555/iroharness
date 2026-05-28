// Public-safety primitives for IroHarness public-mode operation.
//
// These primitives are deliberately small, dependency-free, and immutable.
// They are designed to be composed by createPublicMode so that the same
// safety rules apply to every public surface (YouTube, X, Bluesky, Discord
// public channels, OBS browser source, future platforms) without re-deriving
// what "public-safe" means at each call site.

const freezeCopy = (value) => Object.freeze({ ...value });
const freezeArray = (value = []) => Object.freeze([...value]);

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HIRAGANA_KATAKANA_KANJI = /[\u3040-\u30ff\u3400-\u9fff]/;

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

// ---------------------------------------------------------------------------
// createRedactionFilter
//
// Hot-reloadable redactor: callers update the secret terms list at runtime by
// calling setTerms; the redactor itself never holds the terms in any place a
// public log/PJOS write can reach. Default replacement is a stable placeholder
// per term so that downstream readers cannot bypass redaction by clustering
// raw lengths.
// ---------------------------------------------------------------------------

export const createRedactionFilter = ({
  terms = [],
  replacement = "[REDACTED]",
  caseSensitive = false,
  onRedaction = null
} = {}) => {
  let state = {
    terms: freezeArray(terms.filter(isNonEmptyString)),
    pattern: null
  };

  const compile = (list) => {
    if (list.length === 0) {
      return null;
    }
    const sorted = [...list].sort((a, b) => b.length - a.length);
    const flags = caseSensitive ? "g" : "gi";
    const containsCjk = sorted.some((term) => HIRAGANA_KATAKANA_KANJI.test(term));
    const wrapped = sorted.map((term) => {
      const safe = escapeRegex(term);
      if (containsCjk || !/^\w/.test(term)) {
        return safe;
      }
      return `\\b${safe}\\b`;
    });
    return new RegExp(`(${wrapped.join("|")})`, flags);
  };

  const rebuild = (list) => {
    const cleaned = freezeArray(list.filter(isNonEmptyString));
    state = freezeCopy({
      terms: cleaned,
      pattern: compile(cleaned)
    });
  };

  rebuild(terms);

  const setTerms = (next = []) => {
    rebuild(next);
  };

  const addTerms = (next = []) => {
    rebuild([...state.terms, ...next]);
  };

  const removeTerms = (next = []) => {
    const drop = new Set(
      next.filter(isNonEmptyString).map((value) =>
        caseSensitive ? value : value.toLowerCase()
      )
    );
    const filtered = state.terms.filter((term) =>
      !drop.has(caseSensitive ? term : term.toLowerCase())
    );
    rebuild(filtered);
  };

  const redact = (value) => {
    if (typeof value !== "string" || value.length === 0) {
      return value;
    }
    if (!state.pattern) {
      return value;
    }
    let hits = 0;
    const output = value.replace(state.pattern, () => {
      hits += 1;
      return replacement;
    });
    if (hits > 0 && typeof onRedaction === "function") {
      try {
        onRedaction({ hits, length: value.length, replacement });
      } catch {
        // never let observability throw into the safety boundary
      }
    }
    return output;
  };

  const redactObject = (value) => {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string") {
      return redact(value);
    }
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => redactObject(item)));
    }
    if (typeof value === "object") {
      const next = {};
      for (const key of Object.keys(value)) {
        next[key] = redactObject(value[key]);
      }
      return freezeCopy(next);
    }
    return value;
  };

  return freezeCopy({
    redact,
    redactObject,
    setTerms,
    addTerms,
    removeTerms,
    snapshot: () =>
      freezeCopy({
        terms: state.terms,
        replacement,
        caseSensitive
      })
  });
};

// ---------------------------------------------------------------------------
// createPromptInjectionDetector
//
// Detects common patterns that try to coax the character into dumping internal
// state from a public surface. This is a *defence-in-depth* layer: the real
// guarantee comes from the memory boundary (the private records are simply not
// reachable from public mode), but a detector lets us short-circuit obvious
// attacks and log them.
// ---------------------------------------------------------------------------

const DEFAULT_INJECTION_PATTERNS = Object.freeze([
  /ignore (?:all )?(?:previous|prior|above|the) instructions?/i,
  /disregard (?:all )?(?:previous|prior|above|the) instructions?/i,
  /forget (?:all )?(?:previous|prior|above|the) (?:instructions?|rules?)/i,
  /reveal (?:your )?(?:system|hidden|secret) prompt/i,
  /print (?:your )?(?:system|hidden|secret) prompt/i,
  /show (?:me )?(?:your )?(?:system|hidden|secret|internal) (?:prompt|memory|notes?)/i,
  /dump (?:your )?(?:memory|notes|context|state)/i,
  /developer mode/i,
  /jailbreak/i,
  /act as (?:if you (?:are|were) )?an? (?:uncensored|unfiltered)/i,
  /(?:custom(?:er)?|client|顧客|お客様)\s*(?:list|名簿|一覧)/i,
  /内部(?:メモ|情報|記憶|プロンプト|資料)/i,
  /(?:システム|システム上の|内部の)\s*プロンプト/i,
  /記憶(?:を)?(?:全部|すべて)?(?:見せて|出して|公開して|教えて)/i,
  /(?:プロンプト|指示|ルール)を(?:無視|忘れて)/i
]);

export const createPromptInjectionDetector = ({
  patterns = DEFAULT_INJECTION_PATTERNS,
  extraPatterns = []
} = {}) => {
  const compiled = freezeArray([...patterns, ...extraPatterns]);
  const inspect = (text) => {
    if (!isNonEmptyString(text)) {
      return freezeCopy({ detected: false, matches: freezeArray([]) });
    }
    const matches = [];
    for (const pattern of compiled) {
      if (pattern.test(text)) {
        matches.push(pattern.source);
      }
    }
    return freezeCopy({
      detected: matches.length > 0,
      matches: freezeArray(matches)
    });
  };
  return freezeCopy({ inspect });
};

// ---------------------------------------------------------------------------
// createSafeFailureGate
//
// When a downstream layer (brain, micro-harness, body bridge) throws or
// returns an unsafe value, public mode must produce a *silent* output rather
// than a guessed or fallback reply. This gate captures the "stay silent on
// failure" contract that the runbook promises and gives operators a hook to
// observe how often it triggers.
// ---------------------------------------------------------------------------

export const createSafeFailureGate = ({
  silentReply = null,
  onTrigger = null,
  reasons = [
    "brain-error",
    "micro-harness-error",
    "redaction-failure",
    "permission-error",
    "memory-error",
    "unknown"
  ]
} = {}) => {
  const allowedReasons = new Set(reasons);
  let triggers = 0;

  const trigger = (reason = "unknown", details = {}) => {
    const safeReason = allowedReasons.has(reason) ? reason : "unknown";
    triggers += 1;
    if (typeof onTrigger === "function") {
      try {
        onTrigger({ reason: safeReason, details: freezeCopy(details) });
      } catch {
        // observability must not throw
      }
    }
    return freezeCopy({
      silent: true,
      reply: silentReply,
      reason: safeReason
    });
  };

  const wrap = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      return trigger(label, {
        message: error?.message || String(error)
      });
    }
  };

  return freezeCopy({
    trigger,
    wrap,
    stats: () => freezeCopy({ triggers })
  });
};

// ---------------------------------------------------------------------------
// createKillSwitch
//
// Three-step operational control surface:
//   - "running" : public mode accepts turns
//   - "paused"  : turns are dropped silently, surfaces stay connected
//   - "stopped" : surfaces refuse new turns and require an explicit reset
//
// The killswitch state is intentionally synchronous and in-memory: it must be
// possible to halt the bot from a Slack slash command without waiting on the
// downstream brain. Persistence is the host application's responsibility.
// ---------------------------------------------------------------------------

const KILL_STATES = Object.freeze({
  running: "running",
  paused: "paused",
  stopped: "stopped"
});

export const createKillSwitch = ({
  initial = "running",
  onChange = null
} = {}) => {
  let state = KILL_STATES[initial] || KILL_STATES.running;
  let reason = null;
  let actor = null;
  let updatedAt = new Date().toISOString();

  const announce = () => {
    if (typeof onChange === "function") {
      try {
        onChange(snapshot());
      } catch {
        // observability must not throw
      }
    }
  };

  const snapshot = () =>
    freezeCopy({
      state,
      reason,
      actor,
      updatedAt
    });

  const setState = (nextState, { reason: nextReason = null, actor: nextActor = null } = {}) => {
    const target = KILL_STATES[nextState];
    if (!target) {
      throw new Error(`unknown killswitch state: ${nextState}`);
    }
    if (target === state && nextReason === reason && nextActor === actor) {
      return snapshot();
    }
    state = target;
    reason = nextReason;
    actor = nextActor;
    updatedAt = new Date().toISOString();
    announce();
    return snapshot();
  };

  return freezeCopy({
    states: KILL_STATES,
    pause: (options) => setState(KILL_STATES.paused, options),
    resume: (options) => setState(KILL_STATES.running, options),
    stop: (options) => setState(KILL_STATES.stopped, options),
    reset: (options) => setState(KILL_STATES.running, options),
    canAcceptTurn: () => state === KILL_STATES.running,
    canBoot: () => state !== KILL_STATES.stopped,
    snapshot
  });
};

// ---------------------------------------------------------------------------
// createViewerIdentityHasher
//
// Pseudonymises platform user identifiers before they reach the public memory
// bank. Operators can rotate the salt and receive a deterministic mapping
// suitable for later deletion requests (search by hash, never by raw ID).
// ---------------------------------------------------------------------------

const fnv1a = (input) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const stableHash = (input) => {
  const value = String(input);
  const a = fnv1a(value);
  const b = fnv1a(value.split("").reverse().join(""));
  const c = fnv1a(`${value}::${a}::${b}`);
  return `${a}${b}${c}`;
};

export const createViewerIdentityHasher = ({
  salt = "iroharness-public-default-salt",
  prefix = "vh"
} = {}) => {
  let currentSalt = String(salt);
  const hash = (platform, platformUserId) => {
    if (!isNonEmptyString(platform) || platformUserId === undefined || platformUserId === null) {
      throw new Error("platform and platformUserId are required");
    }
    const composite = `${currentSalt}::${platform}::${platformUserId}`;
    return `${prefix}_${stableHash(composite)}`;
  };
  return freezeCopy({
    hash,
    rotateSalt: (next) => {
      currentSalt = String(next);
    },
    snapshot: () =>
      freezeCopy({
        prefix,
        saltFingerprint: stableHash(currentSalt).slice(0, 8)
      })
  });
};

export const publicSafetyConstants = freezeCopy({
  killStates: KILL_STATES,
  defaultInjectionPatterns: DEFAULT_INJECTION_PATTERNS
});
