const freezeCopy = (value) => Object.freeze({ ...value });

// Enforcement source of truth: any event under these prefixes is realtime (spec §3.5).
const REALTIME_HOOK_PREFIXES = Object.freeze([
  "bargein:",
  "speech:",
  "device:",
]);

const isRealtimeEvent = (event) =>
  REALTIME_HOOK_PREFIXES.some((prefix) => event.startsWith(prefix));

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
    if (isRealtimeEvent(event) && style !== "inprocess") {
      throw new Error(
        `hook style "${style}" is not allowed on realtime event "${event}"; realtime hooks must be in-process`,
      );
    }
    const next = [
      ...(handlers.get(event) || []),
      { style, priority, run: handler },
    ];
    next.sort((a, b) => b.priority - a.priority);
    handlers.set(event, next);
    return registry;
  };

  const dispatch = (event, context = {}) => {
    let current = freezeCopy(context);
    for (const entry of handlers.get(event) || []) {
      const decision = entry.run(current);
      if (decision && decision.block) {
        return freezeCopy({
          event,
          blocked: true,
          reason: decision.block.reason ?? null,
          context: current,
        });
      }
      if (decision && decision.transform) {
        current = freezeCopy({ ...current, ...decision.transform });
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
