// Shallow freeze: top-level is frozen; nested objects/arrays in a context are not.
const freezeCopy = (value) => Object.freeze({ ...value });

// Enforcement source of truth: any event under these prefixes is realtime (spec §3.5).
const REALTIME_HOOK_PREFIXES = Object.freeze([
  "bargein:",
  "speech:",
  "device:",
]);

const isRealtimeEvent = (event) =>
  REALTIME_HOOK_PREFIXES.some((prefix) => event.startsWith(prefix));

// Background events fail open; gate events (and anything unrecognized) fail closed.
const FAIL_OPEN_EVENTS = Object.freeze(new Set(["tool:after", "turn:after"]));

// A throwing handler fails closed (block) on gate/unknown events; on background
// and realtime events it fails open (the broken handler is skipped).
const failModeFor = (event) =>
  isRealtimeEvent(event) || FAIL_OPEN_EVENTS.has(event) ? "open" : "closed";

// Concrete realtime events currently defined (spec §3.3) — for discovery/tests.
export const REALTIME_HOOK_EVENTS = Object.freeze(
  new Set(["bargein:detect", "speech:before", "speech:chunk", "device:emit"]),
);

export const createHookRegistry = () => {
  const handlers = new Map();

  const register = (
    event,
    handler,
    { style = "inprocess", priority = 0 } = {},
  ) => {
    if (typeof event !== "string" || event.length === 0) {
      throw new Error("hook registry register requires a non-empty event name");
    }
    if (typeof handler !== "function") {
      throw new Error("hook registry register requires a handler function");
    }
    if (isRealtimeEvent(event) && style !== "inprocess") {
      throw new Error(
        `hook style "${style}" is not allowed on realtime event "${event}"; realtime hooks must be in-process`,
      );
    }
    const next = [
      ...(handlers.get(event) || []),
      { style, priority, run: handler },
    ];
    // Stable sort: equal-priority handlers run in registration order.
    next.sort((a, b) => b.priority - a.priority);
    handlers.set(event, next);
    return registry;
  };

  const dispatch = (event, context = {}, { protectedKeys = [] } = {}) => {
    let current = freezeCopy(context);
    for (const entry of handlers.get(event) || []) {
      let decision;
      try {
        decision = entry.run(current);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (failModeFor(event) === "closed") {
          return freezeCopy({
            event,
            blocked: true,
            reason: `hook error (fail-closed): ${message}`,
            context: current,
          });
        }
        console.warn(`[hooks] skipping failed hook on ${event}: ${message}`);
        continue;
      }
      if (decision && decision.block) {
        return freezeCopy({
          event,
          blocked: true,
          reason: decision.block.reason ?? null,
          context: current,
        });
      }
      if (
        decision &&
        decision.transform &&
        typeof decision.transform === "object"
      ) {
        const applied = {};
        for (const [key, value] of Object.entries(decision.transform)) {
          if (protectedKeys.includes(key)) {
            console.warn(
              `[hooks] ignoring transform of protected key "${key}" on ${event}`,
            );
            continue;
          }
          applied[key] = value;
        }
        current = freezeCopy({ ...current, ...applied });
      }
    }
    return freezeCopy({
      event,
      blocked: false,
      reason: null,
      context: current,
    });
  };

  const registry = Object.freeze({ kind: "hook-registry", register, dispatch });
  return registry;
};
