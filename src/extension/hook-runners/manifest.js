import { isAbsolute, resolve } from "node:path";
import { createCommandHook } from "./command.js";

export const keyFor = (event, ctx) =>
  event === "tool:before"
    ? (ctx?.route?.harnessId ?? "")
    : (ctx?.route?.kind ?? "");

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
