// Ledger: a derived view over Project OS runs (W-4).
// calls / success / lastUsed / avgScore are computed ONLY from runs, which the
// Hanaita writes via createRun/completeRun. A specialist cannot inflate its own
// score — there is no writable stats store, and artifacts are not consulted.

export const computeLedger = (snapshot) => {
  const runs = snapshot?.runs ?? [];
  const ledger = {};

  for (const run of runs) {
    const id = run.harnessId;
    if (!id) {
      continue;
    }
    const entry =
      ledger[id] ||
      (ledger[id] = { calls: 0, success: 0, lastUsed: null, scores: [] });

    entry.calls += 1;
    if (run.status === "completed") {
      entry.success += 1;
    }
    if (!entry.lastUsed || run.updatedAt > entry.lastUsed) {
      entry.lastUsed = run.updatedAt ?? entry.lastUsed;
    }
    const score = run.output?.qualityScore;
    if (typeof score === "number") {
      entry.scores.push(score);
    }
  }

  for (const id of Object.keys(ledger)) {
    const entry = ledger[id];
    entry.avgScore = entry.scores.length
      ? entry.scores.reduce((sum, score) => sum + score, 0) /
        entry.scores.length
      : null;
    delete entry.scores;
  }

  return ledger;
};
