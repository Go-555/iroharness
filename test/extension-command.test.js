import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHookRegistry } from "../src/extension/hook-registry.js";
import { createCommandHook } from "../src/extension/hook-runners/command.js";

const DECIDE = fileURLToPath(
  new URL("./fixtures/hooks/decide.mjs", import.meta.url),
);
const nodeHook = (extra = {}) =>
  createCommandHook({
    command: process.execPath,
    args: [DECIDE],
    timeout: 5000,
    ...extra,
  });

test("a command hook 'deny' becomes a block", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", {
    input: { text: "deny" },
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "fixture denied");
});

test("a command hook 'allow' + transform rewrites the context", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", {
    input: { text: "rewrite" },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.context.input.text, "REWRITTEN");
});

test("a command hook 'allow' with no transform passes through", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", {
    input: { text: "hello" },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.context.input.text, "hello");
});

test("a command hook 'allow' with a null transform passes through", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", {
    input: { text: "null-transform" },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.context.input.text, "null-transform");
});

test("a command hook 'allow' with an empty-object transform passes through", async () => {
  const registry = createHookRegistry();
  registry.register("turn:before", nodeHook(), { style: "command" });
  const result = await registry.dispatch("turn:before", {
    input: { text: "empty-transform" },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.context.input.text, "empty-transform");
});

test("createCommandHook validates its spec at construction", () => {
  assert.throws(() => createCommandHook({ command: "" }), /command/);
  assert.throws(
    () => createCommandHook({ command: "x", args: "nope" }),
    /args/,
  );
  assert.throws(() => createCommandHook({ command: "x", args: [1] }), /args/);
});

// --- failure-mode routing tests ---

const hookOf = (file, extra = {}) =>
  createCommandHook({
    command: process.execPath,
    args: [fileURLToPath(new URL(`./fixtures/hooks/${file}`, import.meta.url))],
    timeout: 1000,
    ...extra,
  });

const failsClosed = async (file, extra) => {
  const registry = createHookRegistry();
  registry.register("turn:before", hookOf(file, extra), { style: "command" });
  return registry.dispatch("turn:before", { input: { text: "x" } });
};

test("non-zero exit fails closed on a gate event", async () => {
  const r = await failsClosed("exit-nonzero.mjs");
  assert.equal(r.blocked, true);
  assert.match(r.reason, /fail-closed/);
});

test("a timeout fails closed on a gate event", async () => {
  const r = await failsClosed("hang.mjs", { timeout: 200 });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /fail-closed/);
});

test("unparseable stdout fails closed on a gate event", async () => {
  const r = await failsClosed("garbage.mjs");
  assert.equal(r.blocked, true);
});

test("a child that exits without responding fails closed, not an uncaught rejection", async () => {
  // For a small context the kernel pipe buffer absorbs the stdin write, so the
  // child exits 0 with empty stdout -> JSON.parse("") throws -> fail-closed.
  // (The child.stdin.on("error") EPIPE handler is the defensive net for the
  // large-context case; either way the outcome is a controlled block, never an
  // unhandled rejection that would crash the runner.)
  const r = await failsClosed("exit-early.mjs");
  assert.equal(r.blocked, true);
});

test("stdout over 1 MiB fails closed", async () => {
  const r = await failsClosed("flood.mjs");
  assert.equal(r.blocked, true);
});

test("the same failure fails OPEN on a background event", async () => {
  const registry = createHookRegistry();
  registry.register("turn:after", hookOf("exit-nonzero.mjs"), {
    style: "command",
  });
  const r = await registry.dispatch("turn:after", { input: { text: "x" } });
  assert.equal(r.blocked, false); // background -> fail-open -> pass-through
});
