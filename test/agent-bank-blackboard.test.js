import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryProjectOs } from "../src/index.js";
import { createBeadsProjectOs } from "../src/beads-project-os.js";
import { createBlackboard } from "../src/agent-bank/blackboard.js";

// A stateful in-memory fake of the bd CLI, mirroring the real shapes used by
// createBeadsProjectOs (create/update/show/close/list, --set-metadata stores
// nested values as JSON strings — exactly like real bd).
const makeFakeBdExec = () => {
  const beads = new Map();
  let n = 0;
  return (args) => {
    const [cmd] = args;
    if (cmd === "create") {
      const id = `bd-${(n += 1)}`;
      const dIdx = args.indexOf("-d");
      const mIdx = args.indexOf("--metadata");
      const bead = {
        id,
        title: args[1],
        description: dIdx === -1 ? "" : args[dIdx + 1],
        status: "open",
        issue_type: "task",
        metadata: mIdx === -1 ? {} : JSON.parse(args[mIdx + 1]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      beads.set(id, bead);
      return JSON.stringify(bead);
    }
    if (cmd === "update") {
      const bead = beads.get(args[1]);
      for (let i = 2; i < args.length; i += 1) {
        if (args[i] === "--set-metadata") {
          const kv = args[i + 1];
          const eq = kv.indexOf("=");
          // real bd keeps nested values as strings; so does this fake
          bead.metadata[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
      }
      return "";
    }
    if (cmd === "show") {
      return JSON.stringify([beads.get(args[1])]);
    }
    if (cmd === "close") {
      beads.get(args[1]).status = "closed";
      return "";
    }
    if (cmd === "list") {
      return JSON.stringify([...beads.values()]);
    }
    return "";
  };
};

// The blackboard rides the ProjectOs 6-method contract, so the SAME assertions
// must hold on the in-memory backend and on the beads backend (道A).
const backends = [
  ["in-memory", () => createInMemoryProjectOs()],
  ["beads (fake bd)", () => createBeadsProjectOs({ exec: makeFakeBdExec() })],
];

for (const [name, makeProjectOs] of backends) {
  test(`[${name}] a confirmed result is readable; one delegation = one ticket = one run`, () => {
    const projectOs = makeProjectOs();
    const board = createBlackboard({ projectOs, ownerCharacterId: "iroha" });

    const { ticketId, runId } = board.open({
      title: "research water",
      purpose: "is water wet?",
      harnessId: "researcher",
      input: { slice: { instruction: "is water wet?" } },
    });
    board.confirm({
      ticketId,
      runId,
      output: { status: "completed", summary: "FACTS: water is wet" },
      artifacts: [{ kind: "note", uri: "memory://note/1", title: "notes" }],
    });

    const confirmed = board.readConfirmed([ticketId]);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].harnessId, "researcher");
    assert.match(confirmed[0].output.summary, /water is wet/);

    // ledger-compatible shape survives: one run, harnessId-keyed, completed
    const snapshot = projectOs.snapshot();
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.runs[0].harnessId, "researcher");
    assert.equal(snapshot.runs[0].status, "completed");
    assert.equal(snapshot.artifacts.length, 1);
  });

  test(`[${name}] a rejected result is recorded as failed and never served as confirmed`, () => {
    const projectOs = makeProjectOs();
    const board = createBlackboard({ projectOs, ownerCharacterId: "iroha" });

    const { ticketId, runId } = board.open({
      title: "sloppy work",
      purpose: "do it badly",
      harnessId: "sloppy",
      input: { slice: {} },
    });
    board.reject({
      runId,
      output: { status: "failed", summary: "did not pass verify" },
    });

    // the failed run is on the board (the ledger counts the call) ...
    const snapshot = projectOs.snapshot();
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.runs[0].status, "failed");
    // ... but it is NOT a confirmed result for anyone else
    assert.deepEqual(board.readConfirmed([ticketId]), []);
    assert.deepEqual(board.readConfirmed(), []);
  });

  test(`[${name}] readConfirmed scopes to the requested tickets`, () => {
    const projectOs = makeProjectOs();
    const board = createBlackboard({ projectOs, ownerCharacterId: "iroha" });

    const a = board.open({
      title: "a",
      purpose: "a",
      harnessId: "alpha",
      input: {},
    });
    const b = board.open({
      title: "b",
      purpose: "b",
      harnessId: "beta",
      input: {},
    });
    board.confirm({
      ticketId: a.ticketId,
      runId: a.runId,
      output: { status: "completed", summary: "A" },
    });
    board.confirm({
      ticketId: b.ticketId,
      runId: b.runId,
      output: { status: "completed", summary: "B" },
    });

    const onlyA = board.readConfirmed([a.ticketId]);
    assert.equal(onlyA.length, 1);
    assert.equal(onlyA[0].output.summary, "A");
    assert.equal(board.readConfirmed().length, 2);
  });
}
