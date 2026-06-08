const freezeCopy = (value) => Object.freeze({ ...value });

export const createHookRegistry = () => {
  const handlers = new Map();

  const register = (event, handler) => {
    const next = [...(handlers.get(event) || []), { run: handler }];
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
