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
      entry.run(current);
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
