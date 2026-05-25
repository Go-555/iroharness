const isObject = (value) => value !== null && typeof value === "object";

const fail = (message) => {
  throw new Error(message);
};

const requireString = (value, name) => {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${name} must be a non-empty string`);
  }
};

const requireArray = (value, name) => {
  if (!Array.isArray(value)) {
    fail(`${name} must be an array`);
  }
};

const requireFunction = (value, name) => {
  if (typeof value !== "function") {
    fail(`${name} must be a function`);
  }
};

const assertArtifactArray = (artifacts, name) => {
  requireArray(artifacts, name);
  artifacts.forEach((artifact, index) => {
    if (!isObject(artifact)) {
      fail(`${name}[${index}] must be an object`);
    }
    if (artifact.kind !== undefined) {
      requireString(artifact.kind, `${name}[${index}].kind`);
    }
    if (artifact.uri !== undefined) {
      requireString(artifact.uri, `${name}[${index}].uri`);
    }
  });
};

export const assertMicroHarnessContract = async (
  adapter,
  {
    task,
    context,
    allowedStatuses = ["completed", "failed", "needs_attention", "running"]
  } = {}
) => {
  if (!isObject(adapter)) {
    fail("micro harness adapter must be an object");
  }
  requireString(adapter.id, "microHarness.id");
  requireArray(adapter.capabilities, "microHarness.capabilities");
  requireFunction(adapter.run, "microHarness.run");
  if (!isObject(task)) {
    fail("micro harness contract requires a task object");
  }
  if (!isObject(context)) {
    fail("micro harness contract requires a context object");
  }

  const output = await adapter.run(task, context);
  if (!isObject(output)) {
    fail("microHarness.run must return an object");
  }
  requireString(output.status, "microHarness output.status");
  if (!allowedStatuses.includes(output.status)) {
    fail(`microHarness output.status is not allowed: ${output.status}`);
  }
  requireString(output.summary, "microHarness output.summary");
  assertArtifactArray(output.artifacts || [], "microHarness output.artifacts");

  return Object.freeze({
    adapterId: adapter.id,
    status: output.status,
    summary: output.summary,
    artifacts: Object.freeze([...(output.artifacts || [])]),
    output
  });
};

export const assertDeviceContract = async (adapter, { events = [] } = {}) => {
  if (!isObject(adapter)) {
    fail("device adapter must be an object");
  }
  requireString(adapter.id, "device.id");
  requireString(adapter.kind, "device.kind");
  requireArray(adapter.capabilities, "device.capabilities");
  requireFunction(adapter.emit, "device.emit");
  requireArray(events, "device contract events");

  for (const event of events) {
    if (!isObject(event)) {
      fail("device event must be an object");
    }
    requireString(event.type, "device event.type");
    await adapter.emit(event);
  }

  return Object.freeze({
    adapterId: adapter.id,
    eventCount: events.length
  });
};

export const assertBrainContract = async (adapter, { context } = {}) => {
  if (!isObject(adapter)) {
    fail("brain adapter must be an object");
  }
  requireString(adapter.id, "brain.id");
  requireFunction(adapter.respond, "brain.respond");
  if (!isObject(context)) {
    fail("brain contract requires a context object");
  }

  const output = await adapter.respond(context);
  if (!isObject(output)) {
    fail("brain.respond must return an object");
  }
  requireString(output.text, "brain output.text");
  if (output.emotion !== undefined) {
    requireString(output.emotion, "brain output.emotion");
  }

  return Object.freeze({
    adapterId: adapter.id,
    text: output.text,
    emotion: output.emotion || null,
    output
  });
};
