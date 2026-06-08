// beads (bd) backend for the ProjectOs contract.
//
// Design: docs/design-summary.md §3 (B案). beads is the single source of truth.
// A bead = a ticket; the run is folded into the same bead's metadata on close
// (1委譲 = 1 bead). snapshot() re-derives {tickets, runs, artifacts} from
// `bd list --json` so the ledger-compatible shape is preserved and downstream
// (ledger / promotion / adapter) stays unchanged.

// Pure: bd list --json output -> ProjectOs snapshot {tickets, runs, artifacts}.
export const beadsToSnapshot = (beads = []) => {
  const tickets = [];
  const runs = [];

  for (const bead of beads) {
    tickets.push({
      id: bead.id,
      title: bead.title,
      purpose: bead.description,
      acceptance: bead.acceptance_criteria ? [bead.acceptance_criteria] : [],
      ownerCharacterId: bead.metadata?.ownerCharacterId,
      executorHarnessId: bead.metadata?.executorHarnessId ?? null,
      status: bead.status,
      createdAt: bead.created_at,
      updatedAt: bead.updated_at,
    });

    // The run is folded into bead.metadata.run on close (§3.1). One bead = one run.
    const run = bead.metadata?.run;
    if (run) {
      runs.push({
        id: run.id,
        ticketId: bead.id,
        harnessId: run.harnessId,
        status: run.status,
        input: run.input,
        output: run.output,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      });
    }
  }

  return { tickets, runs, artifacts: [] };
};

// ProjectOs backend over beads. `exec(args)` runs the `bd` CLI and returns its
// stdout (injected so the core is testable without bd; real bd via execFileSync).
export const createBeadsProjectOs = ({ exec }) => {
  const createTicket = ({
    title,
    purpose,
    acceptance = [],
    ownerCharacterId,
    executorHarnessId = null,
    metadata = {},
  }) => {
    const args = ["create", title, "-d", purpose, "-t", "task", "--json"];
    if (acceptance.length) {
      args.push("--acceptance", acceptance.join("\n"));
    }
    const folded = { ownerCharacterId, executorHarnessId, ...metadata };
    args.push("--metadata", JSON.stringify(folded));

    const bead = JSON.parse(exec(args));
    return beadsToSnapshot([bead]).tickets[0];
  };

  return { createTicket };
};
