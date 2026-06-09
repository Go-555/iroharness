import { isAbsolute, resolve } from "node:path";
import { createCommandHook } from "./command.js";
import { isRealtimeEvent } from "../hook-registry.js";

export const keyFor = (event, ctx) =>
  event === "tool:before"
    ? (ctx?.route?.harnessId ?? "")
    : (ctx?.route?.kind ?? "");

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const validateEntry = (event, entry, index) => {
  const at = `hooks["${event}"][${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${at}: entry must be an object`);
  if (entry.type === "agent")
    throw new Error(`${at}: agent hooks are not supported until Phase 8`);
  if (entry.type !== "command")
    throw new Error(
      `${at}: type must be "command" (got ${JSON.stringify(entry.type)})`,
    );
  if (typeof entry.command !== "string" || entry.command.trim().length === 0)
    throw new Error(`${at}: command must be a non-empty string`);
  if (entry.matcher !== undefined) {
    if (typeof entry.matcher !== "string")
      throw new Error(`${at}: matcher must be a string`);
    // Compile here purely as a validity check; buildGatedHook compiles it again
    // for use (same string, harmless). This keeps the friendly error here.
    try {
      new RegExp(entry.matcher);
    } catch (e) {
      throw new Error(`${at}: invalid matcher regex: ${e.message}`);
    }
  }
  if (isRealtimeEvent(event))
    throw new Error(
      `${at}: command hooks are not allowed on the realtime event "${event}"`,
    );
};

const buildGatedHook = (event, entry, index, baseDir) => {
  const command = isAbsolute(entry.command)
    ? entry.command
    : resolve(baseDir, entry.command);
  const hook = createCommandHook({
    command,
    args: entry.args,
    timeout: entry.timeout,
    cwd: entry.cwd,
    env: entry.env,
  });
  let re = null;
  if (entry.matcher !== undefined) {
    re = new RegExp(entry.matcher);
  }
  return (ctx) => (!re || re.test(keyFor(event, ctx)) ? hook(ctx) : undefined);
};

export const registerCommandManifest = (
  registry,
  manifest,
  { baseDir = process.cwd() } = {},
) => {
  const hooks = manifest?.hooks ?? {};
  if (!isPlainObject(hooks))
    throw new Error(
      "manifest.hooks must be an object (got array or non-object)",
    );

  // Pass 1 — validate everything, register nothing. Any error (naming
  // event+index) is thrown before a single hook is registered, so a malformed
  // manifest leaves the registry untouched (all-or-nothing load).
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries))
      throw new Error(`manifest.hooks["${event}"] must be an array`);
    entries.forEach((entry, index) => validateEntry(event, entry, index));
  }

  // Pass 2 — register only. Pass 1 guarantees every entry is well-formed and
  // non-realtime, so register() cannot throw on a validation/invariant issue.
  for (const [event, entries] of Object.entries(hooks)) {
    entries.forEach((entry, index) => {
      const gated = buildGatedHook(event, entry, index, baseDir);
      registry.register(event, gated, {
        style: "command",
        priority: entry.priority ?? 0,
      });
    });
  }
  return registry;
};
