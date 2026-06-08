// beads (bd) backend for the ProjectOs contract.
//
// Design: docs/design-summary.md §3 (B案). beads is the single source of truth.
// A bead = a ticket; the run is folded into the same bead's metadata on close
// (1委譲 = 1 bead). snapshot() re-derives {tickets, runs, artifacts} from
// `bd list --json` so the ledger-compatible shape is preserved and downstream
// (ledger / promotion / adapter) stays unchanged.

// bd's --set-metadata encodes nested values as JSON strings, so folded run /
// artifacts come back as strings. Parse them; tolerate already-parsed objects
// (used by direct beadsToSnapshot tests).
const parseMaybe = (value) =>
  typeof value === "string" ? JSON.parse(value) : value;

const nowIso = () => new Date().toISOString();
const createId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

// Pure: bd list --json output -> ProjectOs snapshot {tickets, runs, artifacts}.
export const beadsToSnapshot = (beads = []) => {
  const tickets = [];
  const runs = [];
  const artifacts = [];

  for (const bead of beads) {
    const meta = bead.metadata ?? {};

    tickets.push({
      id: bead.id,
      title: bead.title,
      purpose: bead.description,
      acceptance: bead.acceptance_criteria ? [bead.acceptance_criteria] : [],
      ownerCharacterId: meta.ownerCharacterId,
      executorHarnessId: meta.executorHarnessId ?? null,
      // ProjectOs status (done/needs_attention/open) lives in metadata.projectStatus;
      // fall back to bd's own status when it was never set.
      status: meta.projectStatus ?? bead.status,
      createdAt: bead.created_at,
      updatedAt: bead.updated_at,
    });

    // The run is folded into bead.metadata.run (§3.1). One bead = one run.
    if (meta.run) {
      const run = parseMaybe(meta.run);
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

    if (meta.artifacts) {
      for (const artifact of parseMaybe(meta.artifacts)) {
        artifacts.push(artifact);
      }
    }
  }

  return { tickets, runs, artifacts };
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

  // ProjectOs status (open/done/needs_attention) is distinct from bd status
  // (open/closed). Keep it in metadata.projectStatus, merged via --set-metadata
  // so existing metadata (owner/executor/run) survives.
  const updateTicket = (ticketId, patch = {}) => {
    const args = ["update", ticketId];
    if (patch.status) {
      args.push("--set-metadata", `projectStatus=${patch.status}`);
    }
    exec(args);
  };

  // One delegation = one bead = one run, so the run shares the bead's id.
  const createRun = ({ ticketId, harnessId, input }) => {
    const now = nowIso();
    const run = {
      id: ticketId,
      ticketId,
      harnessId,
      status: "running",
      input,
      output: null,
      createdAt: now,
      updatedAt: now,
    };
    exec(["update", ticketId, "--set-metadata", `run=${JSON.stringify(run)}`]);
    return run;
  };

  // Read the current folded run, mark it complete, write it back, and close the bead.
  const completeRun = (runId, output, status = "completed") => {
    // `bd show --json` returns an array (it can batch ids); take the first.
    const bead = JSON.parse(exec(["show", runId, "--json"]))[0];
    const current = parseMaybe(bead.metadata.run);
    const next = { ...current, status, output, updatedAt: nowIso() };
    exec(["update", runId, "--set-metadata", `run=${JSON.stringify(next)}`]);
    exec(["close", runId]);
    return next;
  };

  // Append to the bead's folded artifacts array (read-modify-write).
  const addArtifact = ({ ticketId, runId, kind, uri, title }) => {
    const bead = JSON.parse(exec(["show", ticketId, "--json"]))[0];
    const existing = bead.metadata?.artifacts
      ? parseMaybe(bead.metadata.artifacts)
      : [];
    const artifact = {
      id: createId("artifact"),
      ticketId,
      runId,
      kind,
      uri,
      title,
      createdAt: nowIso(),
    };
    const next = [...existing, artifact];
    exec([
      "update",
      ticketId,
      "--set-metadata",
      `artifacts=${JSON.stringify(next)}`,
    ]);
    return artifact;
  };

  // Read the whole board (closed beads included via --all) and derive the
  // ledger-compatible {tickets, runs, artifacts} shape.
  const snapshot = () =>
    beadsToSnapshot(JSON.parse(exec(["list", "--all", "--json"])));

  return {
    createTicket,
    updateTicket,
    createRun,
    completeRun,
    addArtifact,
    snapshot,
  };
};
