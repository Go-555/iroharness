import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createFileProjectOs,
  createProjectOsMarkdown
} from "../src/index.js";

test("file-backed PJOS persists tickets and reloads them", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-pjos-"));
  const path = join(dir, "pjos.json");
  const first = createFileProjectOs({ path });
  const ticket = first.createTicket({
    title: "Connect Codex",
    purpose: "Delegate coding work",
    ownerCharacterId: "iroha",
    executorHarnessId: "codex"
  });
  first.updateTicket(ticket.id, { status: "done" });

  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.tickets.length, 1);
  assert.equal(saved.tickets[0].status, "done");

  const second = createFileProjectOs({ path });
  assert.equal(second.snapshot().tickets.length, 1);
  assert.equal(second.snapshot().tickets[0].id, ticket.id);
});

test("PJOS markdown renders durable state", () => {
  const projectOs = createFileProjectOs({
    path: join(mkdtempSync(join(tmpdir(), "iroharness-pjos-md-")), "pjos.json")
  });
  projectOs.createTicket({
    title: "Build M5Stack body",
    purpose: "Render the same character on a dot face",
    ownerCharacterId: "iroha",
    executorHarnessId: "m5stack"
  });

  const markdown = createProjectOsMarkdown(projectOs.snapshot());
  assert.equal(markdown.includes("# IroHarness Project OS"), true);
  assert.equal(markdown.includes("Build M5Stack body"), true);
});
