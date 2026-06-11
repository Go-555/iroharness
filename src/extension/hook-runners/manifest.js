import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createAgentHook } from "./agent.js";
import { createCommandHook } from "./command.js";
import { isRealtimeEvent } from "../hook-registry.js";

// execvp convention: a command containing a path separator is a path (resolved
// against baseDir); a bare name is left for PATH lookup. On POSIX an absolute
// path always contains "/", so the separator test subsumes isAbsolute.
export const resolveCommand = (command, baseDir) =>
  command.includes("/") ? resolve(baseDir, command) : command;

export const keyFor = (event, ctx) =>
  event === "tool:before"
    ? (ctx?.route?.harnessId ?? "")
    : (ctx?.route?.kind ?? "");

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const validateEntry = (event, entry, index) => {
  const at = `hooks["${event}"][${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${at}: entry must be an object`);
  if (entry.type !== "command" && entry.type !== "agent")
    throw new Error(
      `${at}: type must be "command" or "agent" (got ${JSON.stringify(entry.type)})`,
    );
  if (entry.type === "agent") {
    // Phase 8: a manifest DECLARES an agent hook; the judge brain itself is
    // only ever injected from code (registerCommandManifest's `judgeBrain`
    // option) — a manifest alone never connects an LLM.
    if (typeof entry.prompt !== "string" || entry.prompt.trim().length === 0)
      throw new Error(`${at}: prompt must be a non-empty string`);
    if (entry.model !== undefined && typeof entry.model !== "string")
      throw new Error(`${at}: model must be a string`);
  }
  if (
    entry.type === "command" &&
    (typeof entry.command !== "string" || entry.command.trim().length === 0)
  )
    throw new Error(`${at}: command must be a non-empty string`);
  if (
    entry.args !== undefined &&
    (!Array.isArray(entry.args) ||
      entry.args.some((a) => typeof a !== "string"))
  )
    throw new Error(`${at}: args must be an array of strings`);
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
  // Optional fields are consumed by createCommandHook/register; validate their
  // types at the boundary (load) so a bad value fails loud here instead of
  // coercing/throwing later at spawn — and so the .d.ts contract is honest.
  if (
    entry.timeout !== undefined &&
    (typeof entry.timeout !== "number" || !Number.isFinite(entry.timeout))
  )
    throw new Error(`${at}: timeout must be a finite number`);
  if (entry.cwd !== undefined && typeof entry.cwd !== "string")
    throw new Error(`${at}: cwd must be a string`);
  if (entry.env !== undefined) {
    if (!isPlainObject(entry.env))
      throw new Error(`${at}: env must be an object`);
    for (const [key, value] of Object.entries(entry.env))
      if (typeof value !== "string")
        throw new Error(`${at}: env["${key}"] must be a string`);
  }
  // priority feeds register's numeric sort; a non-number poisons it to NaN and
  // silently corrupts handler ordering for the whole event.
  if (
    entry.priority !== undefined &&
    (typeof entry.priority !== "number" || !Number.isFinite(entry.priority))
  )
    throw new Error(`${at}: priority must be a finite number`);
  if (isRealtimeEvent(event))
    throw new Error(
      `${at}: ${entry.type} hooks are not allowed on the realtime event "${event}"`,
    );
};

const buildGatedHook = (event, entry, index, baseDir, judgeBrain) => {
  const hook =
    entry.type === "agent"
      ? createAgentHook({
          judgeBrain,
          prompt: entry.prompt,
          timeout: entry.timeout,
          model: entry.model ?? null,
        })
      : createCommandHook({
          command: resolveCommand(entry.command, baseDir),
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
  { baseDir = process.cwd(), judgeBrain = null } = {},
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
    if (event.length === 0)
      throw new Error("manifest.hooks key must be a non-empty string");
    if (!Array.isArray(entries))
      throw new Error(`manifest.hooks["${event}"] must be an array`);
    entries.forEach((entry, index) => validateEntry(event, entry, index));
  }

  // An agent entry without an injected judgeBrain is legal (declaration vs
  // implementation separation) but inert: it fires fail-open until a brain is
  // injected. Say so once at load — visible, but not an error and not a spam
  // line per entry.
  const agentEntryCount = Object.values(hooks)
    .flat()
    .filter((entry) => entry.type === "agent").length;
  if (agentEntryCount > 0 && !judgeBrain) {
    console.warn(
      `[hooks] ${agentEntryCount} agent entr${agentEntryCount === 1 ? "y" : "ies"} registered without a judgeBrain — gate is inert (fail-open) until one is injected`,
    );
  }

  // Pass 2 — register only. Pass 1 has validated the event key, every entry
  // (type/command/prompt/args/matcher), and the realtime invariant, so neither
  // buildGatedHook (createCommandHook/createAgentHook) nor register() can
  // throw here.
  for (const [event, entries] of Object.entries(hooks)) {
    entries.forEach((entry, index) => {
      const gated = buildGatedHook(event, entry, index, baseDir, judgeBrain);
      registry.register(event, gated, {
        style: entry.type,
        priority: entry.priority ?? 0,
      });
    });
  }
  return registry;
};

export const loadCommandManifestFile = (registry, path, options = {}) => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `failed to read/parse manifest "${path}": ${error.message}`,
    );
  }
  return registerCommandManifest(registry, manifest, {
    ...options,
    baseDir: dirname(path),
  });
};
