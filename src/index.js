import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODES = Object.freeze({
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  working: "working",
  error: "error"
});

const DEFAULT_EMOTION = "neutral";

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

const freezeCopy = (value) => Object.freeze({ ...value });

const createProjectOsStore = (initialState = {}, persist = () => {}) => {
  let tickets = Object.freeze([...(initialState.tickets || [])]);
  let runs = Object.freeze([...(initialState.runs || [])]);
  let artifacts = Object.freeze([...(initialState.artifacts || [])]);

  const rawSnapshot = () => ({
    tickets: [...tickets],
    runs: [...runs],
    artifacts: [...artifacts]
  });

  const save = () => persist(rawSnapshot());

  const createTicket = ({
    title,
    purpose,
    acceptance = [],
    ownerCharacterId,
    executorHarnessId = null,
    metadata = {}
  }) => {
    const ticket = freezeCopy({
      id: createId("ticket"),
      title,
      purpose,
      acceptance: Object.freeze([...acceptance]),
      ownerCharacterId,
      executorHarnessId,
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      metadata: freezeCopy(metadata)
    });
    tickets = Object.freeze([...tickets, ticket]);
    save();
    return ticket;
  };

  const updateTicket = (ticketId, patch) => {
    let nextTicket = null;
    tickets = Object.freeze(
      tickets.map((ticket) => {
        if (ticket.id !== ticketId) {
          return ticket;
        }
        nextTicket = freezeCopy({
          ...ticket,
          ...patch,
          updatedAt: nowIso()
        });
        return nextTicket;
      })
    );
    if (!nextTicket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }
    save();
    return nextTicket;
  };

  const createRun = ({ ticketId, harnessId, input }) => {
    const run = freezeCopy({
      id: createId("run"),
      ticketId,
      harnessId,
      status: "running",
      input,
      output: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    runs = Object.freeze([...runs, run]);
    save();
    return run;
  };

  const completeRun = (runId, output, status = "completed") => {
    let nextRun = null;
    runs = Object.freeze(
      runs.map((run) => {
        if (run.id !== runId) {
          return run;
        }
        nextRun = freezeCopy({
          ...run,
          status,
          output,
          updatedAt: nowIso()
        });
        return nextRun;
      })
    );
    if (!nextRun) {
      throw new Error(`Run not found: ${runId}`);
    }
    save();
    return nextRun;
  };

  const addArtifact = ({ ticketId, runId, kind, uri, title }) => {
    const artifact = freezeCopy({
      id: createId("artifact"),
      ticketId,
      runId,
      kind,
      uri,
      title,
      createdAt: nowIso()
    });
    artifacts = Object.freeze([...artifacts, artifact]);
    save();
    return artifact;
  };

  const snapshot = () =>
    freezeCopy({
      tickets: Object.freeze([...tickets]),
      runs: Object.freeze([...runs]),
      artifacts: Object.freeze([...artifacts])
    });

  return Object.freeze({
    createTicket,
    updateTicket,
    createRun,
    completeRun,
    addArtifact,
    snapshot
  });
};

export const createCharacterState = ({
  characterId,
  mode = MODES.idle,
  emotion = DEFAULT_EMOTION,
  speechText = null,
  taskRef = null,
  mouth = "closed",
  gaze = "user",
  motion = mode,
  metadata = {}
}) =>
  freezeCopy({
    characterId,
    mode,
    emotion,
    speechText,
    taskRef,
    mouth,
    gaze,
    motion,
    metadata: freezeCopy(metadata)
  });

export const createInMemoryProjectOs = () => {
  return createProjectOsStore();
};

export const createFileProjectOs = ({ path }) => {
  if (!path) {
    throw new Error("createFileProjectOs requires path");
  }
  const load = () => {
    if (!existsSync(path)) {
      return {};
    }
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return {};
    }
    return JSON.parse(raw);
  };
  const persist = (snapshot) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  };

  return createProjectOsStore(load(), persist);
};

export const createProjectOsMarkdown = (snapshot) => {
  const ticketLines = snapshot.tickets.map(
    (ticket) =>
      `- [${ticket.status}] ${ticket.id}: ${ticket.title} -> ${ticket.executorHarnessId || "unassigned"}`
  );
  const runLines = snapshot.runs.map(
    (run) => `- [${run.status}] ${run.id}: ${run.harnessId} for ${run.ticketId}`
  );
  const artifactLines = snapshot.artifacts.map(
    (artifact) => `- ${artifact.kind}: [${artifact.title}](${artifact.uri})`
  );

  return [
    "# IroHarness Project OS",
    "",
    "## Tickets",
    ticketLines.length ? ticketLines.join("\n") : "- none",
    "",
    "## Runs",
    runLines.length ? runLines.join("\n") : "- none",
    "",
    "## Artifacts",
    artifactLines.length ? artifactLines.join("\n") : "- none",
    ""
  ].join("\n");
};

export const createHeuristicRouter = () => {
  const workSignals = [
    "codex",
    "実装",
    "修正",
    "作って",
    "レビュー",
    "ファイル",
    "コード",
    "openclaw",
    "hermes"
  ];

  const choose = ({ input, microHarnesses }) => {
    const text = input.text.toLowerCase();
    const isWork = workSignals.some((signal) => text.includes(signal.toLowerCase()));
    if (!isWork) {
      return freezeCopy({
        kind: input.modality === "voice" ? "voice" : "text",
        harnessId: null,
        reason: "No work signal detected"
      });
    }

    const mentionedHarness = microHarnesses.find((harness) =>
      text.includes(harness.id.toLowerCase())
    );
    const selectedHarness = mentionedHarness || microHarnesses[0] || null;

    return freezeCopy({
      kind: selectedHarness ? "work" : "text",
      harnessId: selectedHarness ? selectedHarness.id : null,
      reason: selectedHarness
        ? `Delegating to ${selectedHarness.id}`
        : "Work requested but no micro harness is registered"
    });
  };

  return Object.freeze({ choose });
};

export const createEchoBrain = (id) =>
  Object.freeze({
    id,
    async respond({ character, input, route }) {
      const prefix = input.modality === "voice" ? "うん。" : "";
      const text =
        route.kind === "voice"
          ? `${prefix}${character.name}として聞いているよ。`
          : `${prefix}${character.name}として受け取ったよ。`;
      return freezeCopy({
        text,
        emotion: "attentive"
      });
    }
  });

export const createStubMicroHarness = (id, capabilities = []) =>
  Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    async run(task) {
      return freezeCopy({
        status: "completed",
        summary: `${id} accepted: ${task.title}`,
        artifacts: Object.freeze([])
      });
    }
  });

export const createRecorderDevice = (id) => {
  let events = [];
  return Object.freeze({
    id,
    kind: "recorder",
    capabilities: Object.freeze(["state", "speech", "task"]),
    emit(event) {
      events = Object.freeze([...events, freezeCopy(event)]);
    },
    events() {
      return Object.freeze([...events]);
    }
  });
};

export const createConsoleDevice = (id = "console") =>
  Object.freeze({
    id,
    kind: "console",
    capabilities: Object.freeze(["state", "speech", "task"]),
    emit(event) {
      if (event.type === "speech") {
        console.log(`[${id}] ${event.text}`);
      }
      if (event.type === "state") {
        console.log(`[${id}] ${event.state.mode}:${event.state.emotion}`);
      }
      if (event.type === "task") {
        console.log(`[${id}] ${event.status} ${event.ticketId}`);
      }
    }
  });

export const createIroHarness = ({
  character,
  projectOs,
  router = createHeuristicRouter(),
  brains,
  devices = [],
  microHarnesses = []
}) => {
  if (!character || !character.id || !character.name) {
    throw new Error("character.id and character.name are required");
  }
  if (!projectOs) {
    throw new Error("projectOs is required");
  }
  if (!brains || !brains.voice || !brains.text) {
    throw new Error("brains.voice and brains.text are required");
  }

  let state = createCharacterState({
    characterId: character.id,
    mode: MODES.idle,
    emotion: DEFAULT_EMOTION
  });

  const emit = (event) => {
    devices.forEach((device) => device.emit(event));
  };

  const setState = (nextState) => {
    state = createCharacterState({
      characterId: character.id,
      ...nextState
    });
    emit({
      type: "state",
      state,
      timestamp: nowIso()
    });
    return state;
  };

  const receive = async (input) => {
    if (!input || !input.text || !input.modality || !input.source) {
      throw new Error("input.source, input.modality, and input.text are required");
    }

    setState({
      mode: MODES.thinking,
      emotion: "focused",
      speechText: null,
      mouth: "closed",
      motion: MODES.thinking
    });

    const route = router.choose({
      input,
      character,
      microHarnesses
    });

    if (route.kind === "work" && route.harnessId) {
      return runMicroHarness(input, route);
    }

    const brain = route.kind === "voice" ? brains.voice : brains.text;
    const response = await brain.respond({
      character,
      input,
      route,
      state,
      projectOs: projectOs.snapshot()
    });

    setState({
      mode: MODES.speaking,
      emotion: response.emotion || "attentive",
      speechText: response.text,
      mouth: "talking",
      motion: MODES.speaking
    });
    emit({
      type: "speech",
      text: response.text,
      modality: input.modality,
      brainId: brain.id,
      timestamp: nowIso()
    });
    setState({
      mode: MODES.idle,
      emotion: response.emotion || "attentive",
      speechText: null,
      mouth: "closed",
      motion: MODES.idle
    });

    return freezeCopy({
      kind: "response",
      route,
      text: response.text,
      brainId: brain.id
    });
  };

  const runMicroHarness = async (input, route) => {
    const microHarness = microHarnesses.find((candidate) => candidate.id === route.harnessId);
    if (!microHarness) {
      throw new Error(`Micro harness not found: ${route.harnessId}`);
    }

    const ticket = projectOs.createTicket({
      title: input.text.slice(0, 80),
      purpose: input.text,
      acceptance: ["Micro harness returns a status", "PJOS records the run"],
      ownerCharacterId: character.id,
      executorHarnessId: microHarness.id,
      metadata: {
        source: input.source,
        modality: input.modality
      }
    });

    setState({
      mode: MODES.working,
      emotion: "focused",
      speechText: "見てみるね。",
      taskRef: ticket.id,
      mouth: "talking",
      motion: MODES.working
    });
    emit({
      type: "speech",
      text: "見てみるね。",
      modality: input.modality,
      brainId: "macro-reflex",
      timestamp: nowIso()
    });
    emit({
      type: "task",
      status: "started",
      ticketId: ticket.id,
      harnessId: microHarness.id,
      timestamp: nowIso()
    });

    const run = projectOs.createRun({
      ticketId: ticket.id,
      harnessId: microHarness.id,
      input
    });
    const output = await microHarness.run(ticket, {
      character,
      input,
      projectOs: projectOs.snapshot()
    });
    const completedRun = projectOs.completeRun(run.id, output, output.status);
    const artifacts = Array.isArray(output.artifacts)
      ? output.artifacts.map((artifact) =>
          projectOs.addArtifact({
            ticketId: ticket.id,
            runId: run.id,
            kind: artifact.kind || "generic",
            uri: artifact.uri || "",
            title: artifact.title || artifact.uri || "artifact"
          })
        )
      : [];
    projectOs.updateTicket(ticket.id, {
      status: output.status === "completed" ? "done" : "needs_attention"
    });

    emit({
      type: "task",
      status: output.status,
      ticketId: ticket.id,
      runId: run.id,
      harnessId: microHarness.id,
      summary: output.summary,
      timestamp: nowIso()
    });
    setState({
      mode: MODES.idle,
      emotion: "relieved",
      speechText: null,
      taskRef: ticket.id,
      mouth: "closed",
      motion: MODES.idle
    });

    return freezeCopy({
      kind: "delegation",
      route,
      ticket,
      run: completedRun,
      output,
      artifacts: Object.freeze(artifacts)
    });
  };

  return Object.freeze({
    character: freezeCopy(character),
    receive,
    state: () => state,
    projectOs: () => projectOs.snapshot()
  });
};

export const constants = Object.freeze({
  MODES
});
