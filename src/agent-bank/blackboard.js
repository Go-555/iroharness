// Blackboard (Phase 4.2) — the shared plate, over the Project OS 6-method
// contract (createTicket / createRun / completeRun / addArtifact / snapshot).
// Works identically on every ProjectOs backend (in-memory, file, beads).
//
// bd-isolation invariant (§8 / design-summary §5): ONLY the Hanaita holds this
// handle. Specialists never receive the projectOs object or any write surface;
// they get plain data slices and their confirmed outputs are written back here
// BY the Hanaita. One delegation = one ticket = one run (§3.1), so the ledger
// derivation (computeLedger over snapshot().runs by harnessId) keeps working.

export const createBlackboard = ({ projectOs, ownerCharacterId = "iroha" }) => {
  if (!projectOs || typeof projectOs.snapshot !== "function") {
    throw new Error(
      "createBlackboard requires a ProjectOs handle (the 6-method contract)",
    );
  }

  // Open one delegation: a ticket plus its (single) run, keyed by the
  // specialist's harnessId so the derived ledger attributes the call.
  const open = ({ title, purpose, harnessId, input }) => {
    const ticket = projectOs.createTicket({
      title,
      purpose,
      ownerCharacterId,
      executorHarnessId: harnessId,
    });
    const run = projectOs.createRun({
      ticketId: ticket.id,
      harnessId,
      input,
    });
    return { ticketId: ticket.id, runId: run.id };
  };

  // Confirm a verified result onto the board. Only confirmed outputs are ever
  // readable by other specialists (readConfirmed below).
  const confirm = ({ ticketId, runId, output, artifacts = [] }) => {
    const run = projectOs.completeRun(runId, output, "completed");
    for (const artifact of artifacts) {
      projectOs.addArtifact({
        ticketId,
        runId,
        kind: artifact.kind,
        uri: artifact.uri,
        title: artifact.title,
      });
    }
    return run;
  };

  // Record a failed delegation (verify exhausted / runner failure). The run is
  // closed as "failed" so the ledger counts the call without a success — and
  // readConfirmed never serves it to another specialist.
  const reject = ({ runId, output }) =>
    projectOs.completeRun(runId, output, "failed");

  // Read CONFIRMED results only (status === "completed"), optionally limited
  // to a set of ticket ids. This is the only cross-specialist data path.
  const readConfirmed = (ticketIds = null) => {
    const wanted = ticketIds === null ? null : new Set(ticketIds);
    return projectOs
      .snapshot()
      .runs.filter((run) => run.status === "completed")
      .filter((run) => wanted === null || wanted.has(run.ticketId))
      .map((run) => ({
        ticketId: run.ticketId,
        harnessId: run.harnessId,
        output: run.output,
      }));
  };

  return Object.freeze({ open, confirm, reject, readConfirmed });
};
