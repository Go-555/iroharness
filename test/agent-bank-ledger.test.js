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

// ajimi (NaN gate): `typeof NaN === "number"`, so without a finiteness filter a
// single run reporting `qualityScore: NaN` would drag avgScore to NaN — and
// `NaN < minScore` is false, so the promotion threshold gate would be walked
// straight past. Non-finite scores must be ignored entirely.
test("computeLedger ignores NaN quality scores instead of poisoning avgScore", () => {
  const snapshot = {
    runs: [
      {
        harnessId: "x",
        status: "completed",
        output: { qualityScore: 5 },
        updatedAt: "2026-06-01T00:00:00Z",
      },
      {
        harnessId: "x",
        status: "completed",
        output: { qualityScore: NaN },
        updatedAt: "2026-06-02T00:00:00Z",
      },
    ],
  };

  const ledger = computeLedger(snapshot);

  assert.equal(ledger["x"].avgScore, 5);
});

test("computeLedger ignores Infinity quality scores", () => {
  const snapshot = {
    runs: [
      {
        harnessId: "x",
        status: "completed",
        output: { qualityScore: Infinity },
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ],
  };

  const ledger = computeLedger(snapshot);

  // No finite score recorded -> avgScore stays null (gate-blocking), not NaN/Infinity.
  assert.equal(ledger["x"].avgScore, null);
});

test("a NaN-only score history cannot slip through the promotion threshold", () => {
  const snapshot = {
    runs: [1, 2, 3].map((day) => ({
      harnessId: "nan-bandit",
      status: "completed",
      output: { qualityScore: NaN },
      updatedAt: `2026-06-0${day}T00:00:00Z`,
    })),
  };

  const ledger = computeLedger(snapshot);

  // avgScore must be null (no usable scores), so the `avgScore == null` branch
  // of the threshold gate blocks promotion. It must never be NaN, which would
  // make `avgScore < minScore` false and bypass the gate.
  assert.equal(ledger["nan-bandit"].avgScore, null);
  assert.equal(Number.isNaN(ledger["nan-bandit"].avgScore), false);
});
