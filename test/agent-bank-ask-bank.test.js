// A2: ask_bank — the menu of ACTIVE regulars for an LLM (Iroha) to choose
// from. No machine ranking: askBank returns a compact structure + text and
// the consumer (brain context / Hanaita chooseRecipe) does the choosing.
// Selection is a proposal; authority stays with the hire gate (active-only).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createInMemoryProjectOs } from "../src/index.js";
import { askBank } from "../src/agent-bank/ask-bank.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-ask-"));

const writeRecipe = (
  root,
  status,
  id,
  { role = `${id} specialist`, toolset = ["doc-read"] } = {},
) => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "recipe.md"),
    [
      "---",
      `id: ${id}`,
      `role: ${role}`,
      `toolset: [${toolset.join(", ")}]`,
      "---",
      "",
      `You are the ${id} specialist.`,
      "",
    ].join("\n"),
  );
};

// Record one completed run for a specialist via the ProjectOs contract so the
// derived ledger (computeLedger) sees it.
const recordRun = (projectOs, harnessId, { qualityScore = null } = {}) => {
  const ticket = projectOs.createTicket({
    title: `work for ${harnessId}`,
    purpose: "test",
    ownerCharacterId: "iroha",
    executorHarnessId: harnessId,
  });
  const run = projectOs.createRun({
    ticketId: ticket.id,
    harnessId,
    input: {},
  });
  projectOs.completeRun(
    run.id,
    qualityScore === null
      ? { status: "completed", summary: "ok" }
      : { status: "completed", summary: "ok", qualityScore },
    "completed",
  );
};

test("askBank lists active recipes with role, capabilities and ledger stats", () => {
  const root = makeBank();
  writeRecipe(root, "active", "tax-helper", {
    role: "Japanese tax specialist",
    toolset: ["spreadsheet-read", "doc-write"],
  });
  const projectOs = createInMemoryProjectOs();
  recordRun(projectOs, "tax-helper", { qualityScore: 4 });
  recordRun(projectOs, "tax-helper", { qualityScore: 5 });

  const listing = askBank({ root, projectOs });

  assert.equal(listing.recipes.length, 1);
  const entry = listing.recipes[0];
  assert.equal(entry.id, "tax-helper");
  assert.equal(entry.role, "Japanese tax specialist");
  assert.deepEqual([...entry.capabilities], ["spreadsheet-read", "doc-write"]);
  assert.equal(entry.ledger.calls, 2);
  assert.equal(entry.ledger.success, 2);
  assert.equal(entry.ledger.avgScore, 4.5);
  assert.equal(typeof entry.ledger.lastUsed, "string");

  // the text menu carries the same facts for an LLM to read
  assert.match(listing.text, /tax-helper/);
  assert.match(listing.text, /Japanese tax specialist/);
  assert.match(listing.text, /spreadsheet-read/);
  assert.match(listing.text, /calls 2/);
  assert.match(listing.text, /avg score 4\.5/);
});

test("staging and archived recipes never appear on the menu", () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  writeRecipe(root, "staging", "trainee");
  writeRecipe(root, "archived", "retired");

  const listing = askBank({ root, projectOs: createInMemoryProjectOs() });

  assert.deepEqual(
    listing.recipes.map((entry) => entry.id),
    ["researcher"],
  );
  assert.doesNotMatch(listing.text, /trainee/);
  assert.doesNotMatch(listing.text, /retired/);
});

test("an untried active recipe lists with a null ledger and says so in text", () => {
  const root = makeBank();
  writeRecipe(root, "active", "fresh-face");

  const listing = askBank({ root, projectOs: createInMemoryProjectOs() });

  assert.equal(listing.recipes[0].ledger, null);
  assert.match(listing.text, /untried/);
});

test("askBank works without a projectOs handle (no ledger column)", () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");

  const listing = askBank({ root });

  assert.equal(listing.recipes.length, 1);
  assert.equal(listing.recipes[0].ledger, null);
});

test("askBank requires the bank root", () => {
  assert.throws(() => askBank({}), /root/);
});

test("the listing is frozen (consumers cannot taint the menu)", () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");

  const listing = askBank({ root });

  assert.ok(Object.isFrozen(listing));
  assert.ok(Object.isFrozen(listing.recipes));
  assert.ok(Object.isFrozen(listing.recipes[0]));
  assert.ok(Object.isFrozen(listing.recipes[0].capabilities));
});
