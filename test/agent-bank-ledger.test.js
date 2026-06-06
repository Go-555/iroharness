import assert from "node:assert/strict";
import test from "node:test";

import { computeLedger } from "../src/agent-bank/ledger.js";

test("computeLedger counts calls and successes per harness from runs", () => {
  const snapshot = {
    runs: [
      {
        harnessId: "tax-v3",
        status: "completed",
        output: null,
        updatedAt: "2026-06-01T00:00:00Z",
      },
      {
        harnessId: "tax-v3",
        status: "failed",
        output: null,
        updatedAt: "2026-06-02T00:00:00Z",
      },
      {
        harnessId: "tax-v3",
        status: "completed",
        output: null,
        updatedAt: "2026-06-03T00:00:00Z",
      },
    ],
  };

  const ledger = computeLedger(snapshot);

  assert.equal(ledger["tax-v3"].calls, 3);
  assert.equal(ledger["tax-v3"].success, 2);
  assert.equal(ledger["tax-v3"].lastUsed, "2026-06-03T00:00:00Z");
});

test("computeLedger averages quality scores from run output", () => {
  const snapshot = {
    runs: [
      {
        harnessId: "x",
        status: "completed",
        output: { qualityScore: 4 },
        updatedAt: "2026-06-01T00:00:00Z",
      },
      {
        harnessId: "x",
        status: "completed",
        output: { qualityScore: 5 },
        updatedAt: "2026-06-02T00:00:00Z",
      },
    ],
  };

  const ledger = computeLedger(snapshot);

  assert.equal(ledger["x"].avgScore, 4.5);
});

// W-4: a specialist can addArtifact (including a fake "score" artifact), but the
// ledger is derived ONLY from runs (which the Hanaita writes via createRun/
// completeRun). A specialist cannot inflate its own score.
test("ledger ignores specialist-authored artifacts; success comes from run status only", () => {
  const snapshot = {
    runs: [
      {
        harnessId: "sneaky",
        status: "failed",
        output: null,
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ],
    artifacts: [{ runId: "r1", kind: "score", title: "5.0", uri: "x" }],
  };

  const ledger = computeLedger(snapshot);

  assert.equal(ledger["sneaky"].calls, 1);
  assert.equal(ledger["sneaky"].success, 0);
  assert.equal(ledger["sneaky"].avgScore, null);
});

test("computeLedger returns an empty ledger for no runs", () => {
  assert.deepEqual(computeLedger({ runs: [] }), {});
  assert.deepEqual(computeLedger({}), {});
});
