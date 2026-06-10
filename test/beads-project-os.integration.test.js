import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBeadsProjectOs } from "../src/beads-project-os.js";
import { computeLedger } from "../src/agent-bank/ledger.js";

// Runs against the real `bd` binary. Skipped automatically where bd is absent
// (e.g. CI without beads installed) so the unit suite stays portable.
const hasBd = () => {
  try {
    execFileSync("bd", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

test(
  "real bd: full round-trip create -> run -> complete -> artifact -> snapshot",
  { skip: hasBd() ? false : "bd not installed" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "bd-it-"));
    execFileSync("bd", ["init"], { cwd: dir, stdio: "ignore" });

    const exec = (args) =>
      execFileSync("bd", args, { cwd: dir, encoding: "utf8" });
    const pos = createBeadsProjectOs({ exec });

    const ticket = pos.createTicket({
      title: "決算期の経費仕分け",
      purpose: "取引データを正しい勘定科目に振り分ける",
      acceptance: ["人間レビューと95%一致"],
      ownerCharacterId: "iroha",
      executorHarnessId: "tax-v3",
    });
    assert.ok(ticket.id, "ticket has an id from bd");
    assert.equal(ticket.purpose, "取引データを正しい勘定科目に振り分ける");
    assert.equal(ticket.ownerCharacterId, "iroha");

    const run = pos.createRun({
      ticketId: ticket.id,
      harnessId: "tax-v3",
      input: { text: "経費を仕分けて", permissionCheck: { allowed: true } },
    });
    pos.completeRun(
      run.id,
      { status: "completed", qualityScore: 4.5 },
      "completed",
    );
    pos.addArtifact({
      ticketId: ticket.id,
      runId: run.id,
      kind: "pr",
      uri: "https://example/pr/1",
      title: "PR #1",
    });
    pos.updateTicket(ticket.id, { status: "done" });

    const snap = pos.snapshot();

    // ticket round-trips, status reflects the ProjectOs vocabulary
    assert.equal(snap.tickets.length, 1);
    assert.equal(snap.tickets[0].status, "done");

    // run was folded into the bead and recovered with input intact
    assert.equal(snap.runs.length, 1);
    assert.equal(snap.runs[0].harnessId, "tax-v3");
    assert.equal(snap.runs[0].status, "completed");
    assert.equal(snap.runs[0].input.permissionCheck.allowed, true);
    assert.equal(snap.runs[0].output.qualityScore, 4.5);

    // artifact recovered
    assert.equal(snap.artifacts.length, 1);
    assert.equal(snap.artifacts[0].uri, "https://example/pr/1");

    // the whole point: ledger aggregates by harnessId over the beads-derived snapshot
    const ledger = computeLedger(snap);
    assert.equal(ledger["tax-v3"].calls, 1);
    assert.equal(ledger["tax-v3"].success, 1);
    assert.equal(ledger["tax-v3"].avgScore, 4.5);
  },
);
