const nowIso = () => new Date().toISOString();

const createTaskId = () =>
  `voice_task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeText = (value, fallback = "") =>
  String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim();

const normalizeReportChannel = (value, fallback = "voice") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["voice", "slack", "both", "none"].includes(normalized)) return normalized;
  return fallback;
};

const resultText = (result) =>
  normalizeText(
    result?.resultText ||
      result?.text ||
      result?.output?.summary ||
      result?.summary ||
      result?.answer ||
      result?.message ||
      "",
  );

const makeTextStream = (text) =>
  (async function* streamText() {
    yield Object.freeze({ delta: text });
  })();

const safeJsonParse = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const taskSnapshot = (task) =>
  task
    ? Object.freeze({
        id: task.id,
        type: task.type,
        title: task.title,
        prompt: task.prompt,
        status: task.status,
        reportChannel: task.reportChannel,
        slackTarget: task.slackTarget,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt ?? null,
        resultText: task.resultText ?? null,
        error: task.error ?? null,
      })
    : null;

const normalizePlannerDecision = (value) => {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  const intent = String(parsed?.intent || "fast_chat").trim();
  const ack = normalizeText(parsed?.ack, "");
  const updates = parsed?.updates && typeof parsed.updates === "object" ? parsed.updates : {};
  const task = parsed?.task && typeof parsed.task === "object" ? parsed.task : {};
  const taskReportChannel = task.report_channel || task.reportChannel;
  return Object.freeze({
    intent,
    ack,
    reply: normalizeText(parsed?.reply, ""),
    task: Object.freeze({
      type: normalizeText(task.type, normalizeText(parsed?.task_type, "general")),
      title: normalizeText(task.title, normalizeText(task.query, "Voice task")),
      prompt: normalizeText(task.prompt, normalizeText(task.query, "")),
      reportChannel: taskReportChannel ? normalizeReportChannel(taskReportChannel, "voice") : null,
      slackTarget: normalizeText(task.slack_target || task.slackTarget, ""),
      metadata: task.metadata && typeof task.metadata === "object" ? Object.freeze({ ...task.metadata }) : Object.freeze({}),
    }),
    targetTaskId: normalizeText(parsed?.task_id || parsed?.targetTask || parsed?.active_task_ref, ""),
    updates: Object.freeze({
      reportChannel:
        updates.delivery || updates.report_channel || updates.reportChannel
          ? normalizeReportChannel(updates.delivery || updates.report_channel || updates.reportChannel)
          : null,
      slackTarget: updates.slack_target || updates.slackTarget ? normalizeText(updates.slack_target || updates.slackTarget) : null,
    }),
  });
};

const completionSummary = (task) => {
  if (task.status === "failed") {
    return `${task.title}は失敗したよ。${task.error || ""}`.trim();
  }
  return resultText(task) || `${task.title}が完了したよ。`;
};

const voiceTaskDecisionJsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["intent", "ack", "reply", "task_id", "task", "updates"],
  properties: {
    intent: {
      type: "string",
      enum: ["fast_chat", "start_task", "update_active_task", "check_task_status", "cancel_task"],
    },
    ack: { type: "string" },
    reply: { type: "string" },
    task_id: { type: "string" },
    task: {
      type: "object",
      additionalProperties: false,
      required: ["type", "title", "prompt", "report_channel", "slack_target"],
      properties: {
        type: { type: "string" },
        title: { type: "string" },
        prompt: { type: "string" },
        report_channel: {
          type: "string",
          enum: ["", "voice", "slack", "both", "none"],
        },
        slack_target: { type: "string" },
      },
    },
    updates: {
      type: "object",
      additionalProperties: false,
      required: ["report_channel", "slack_target"],
      properties: {
        report_channel: {
          type: "string",
          enum: ["", "voice", "slack", "both", "none"],
        },
        slack_target: { type: "string" },
      },
    },
  },
});

const createTextOptions = ({ verbosity }) =>
  Object.freeze({
    verbosity,
    format: {
      type: "json_schema",
      name: "voice_task_decision",
      strict: true,
      schema: voiceTaskDecisionJsonSchema,
    },
  });

const extractOpenAiResponseOutputText = (payload, fallback = "") => {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (typeof payload?.text === "string") return payload.text;
  const outputText = Array.isArray(payload?.output)
    ? payload.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((content) => (typeof content?.text === "string" ? content.text : typeof content?.value === "string" ? content.value : ""))
        .join("")
    : "";
  return outputText || fallback;
};

export const createVoiceTaskOrchestrator = ({
  harness,
  planner,
  runTask,
  deliverVoice = async () => {},
  deliverSlack = async () => {},
  defaultReportChannel = "voice",
  defaultSlackTarget = "",
  onEvent = () => {},
} = {}) => {
  if (!harness || typeof harness.receiveStream !== "function") {
    throw new Error("createVoiceTaskOrchestrator requires harness.receiveStream");
  }
  if (typeof planner !== "function") {
    throw new Error("createVoiceTaskOrchestrator requires planner");
  }
  if (typeof runTask !== "function") {
    throw new Error("createVoiceTaskOrchestrator requires runTask");
  }

  const tasks = new Map();
  let latestTaskId = null;

  const emit = (event) => onEvent(Object.freeze({ ...event, timestamp: nowIso() }));

  const resolveTask = (taskId) => {
    if (!taskId || taskId === "latest") return tasks.get(latestTaskId) || null;
    return tasks.get(taskId) || null;
  };

  const deliverTaskResult = async (task) => {
    if (!task || task.delivered) return;
    const text = completionSummary(task);
    const channel = normalizeReportChannel(task.reportChannel, defaultReportChannel);
    try {
      if (channel === "voice" || channel === "both") {
        await deliverVoice({ task: taskSnapshot(task), text });
      }
      if (channel === "slack" || channel === "both") {
        await deliverSlack({
          task: taskSnapshot(task),
          text,
          target: task.slackTarget || defaultSlackTarget,
        });
      }
      task.delivered = true;
      task.updatedAt = nowIso();
      emit({ type: "voice_task.delivered", task: taskSnapshot(task), channel });
    } catch (error) {
      task.deliveryError = String(error?.message ?? error);
      task.updatedAt = nowIso();
      emit({ type: "voice_task.delivery_error", task: taskSnapshot(task), message: task.deliveryError });
      try {
        await deliverVoice({
          task: taskSnapshot(task),
          text: `結果の送信で失敗したよ。${task.deliveryError}`,
        });
      } catch {
        // ignore secondary failure
      }
    }
  };

  const runBackground = (task, input) => {
    task.promise = Promise.resolve()
      .then(() => runTask({ task: taskSnapshot(task), input }))
      .then(async (result) => {
        if (task.status === "canceled") {
          emit({ type: "voice_task.completed_after_cancel", task: taskSnapshot(task) });
          return;
        }
        task.status = "completed";
        task.result = result;
        task.resultText = resultText(result);
        task.completedAt = nowIso();
        task.updatedAt = task.completedAt;
        emit({ type: "voice_task.completed", task: taskSnapshot(task) });
        await deliverTaskResult(task);
      })
      .catch(async (error) => {
        if (task.status === "canceled") {
          emit({ type: "voice_task.failed_after_cancel", task: taskSnapshot(task), message: String(error?.message ?? error) });
          return;
        }
        task.status = "failed";
        task.error = String(error?.message ?? error);
        task.completedAt = nowIso();
        task.updatedAt = task.completedAt;
        emit({ type: "voice_task.failed", task: taskSnapshot(task), message: task.error });
        await deliverTaskResult(task);
      });
    task.promise.catch(() => null);
  };

  const immediateStream = ({ text, result }) =>
    Object.freeze({
      stream: makeTextStream(text),
      finalize: async () => result,
      abandon: () => {},
    });

  const startTask = (decision, input) => {
    const task = {
      id: createTaskId(),
      type: decision.task.type || "general",
      title: decision.task.title || input.text.slice(0, 80) || "Voice task",
      prompt: decision.task.prompt || input.text,
      reportChannel: normalizeReportChannel(decision.task.reportChannel, defaultReportChannel),
      slackTarget: decision.task.slackTarget || defaultSlackTarget,
      metadata: decision.task.metadata || {},
      status: "running",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      resultText: null,
      error: null,
      delivered: false,
    };
    tasks.set(task.id, task);
    latestTaskId = task.id;
    emit({ type: "voice_task.started", task: taskSnapshot(task) });
    runBackground(task, input);
    const ack = decision.ack || "やってみるね。";
    return immediateStream({
      text: ack,
      result: Object.freeze({
        kind: "voice_task_started",
        text: ack,
        task: taskSnapshot(task),
      }),
    });
  };

  const updateTask = async (decision) => {
    const task = resolveTask(decision.targetTaskId);
    if (!task) {
      const text = decision.ack || "進行中のタスクが見つからないよ。";
      return immediateStream({
        text,
        result: Object.freeze({ kind: "voice_task_missing", text }),
      });
    }
    if (decision.updates.reportChannel) {
      task.reportChannel = decision.updates.reportChannel;
      task.delivered = false;
    }
    if (decision.updates.slackTarget) {
      task.slackTarget = decision.updates.slackTarget;
      task.delivered = false;
    }
    task.updatedAt = nowIso();
    emit({ type: "voice_task.updated", task: taskSnapshot(task) });
    if (["completed", "failed"].includes(task.status)) {
      await deliverTaskResult(task);
    }
    const ack = decision.ack || "反映しておくね。";
    return immediateStream({
      text: ack,
      result: Object.freeze({
        kind: "voice_task_updated",
        text: ack,
        task: taskSnapshot(task),
      }),
    });
  };

  const checkTask = (decision) => {
    const task = resolveTask(decision.targetTaskId);
    const text = task
      ? `${task.title}は${task.status}だよ。`
      : "進行中のタスクはないよ。";
    return immediateStream({
      text,
      result: Object.freeze({
        kind: "voice_task_status",
        text,
        task: taskSnapshot(task),
      }),
    });
  };

  const cancelTask = (decision) => {
    const task = resolveTask(decision.targetTaskId);
    if (!task) {
      const text = decision.ack || "止めるタスクが見つからないよ。";
      return immediateStream({
        text,
        result: Object.freeze({ kind: "voice_task_missing", text }),
      });
    }
    task.status = "canceled";
    task.updatedAt = nowIso();
    task.completedAt = task.updatedAt;
    task.delivered = true;
    emit({ type: "voice_task.canceled", task: taskSnapshot(task) });
    const text = decision.ack || "止めておくね。";
    return immediateStream({
      text,
      result: Object.freeze({
        kind: "voice_task_canceled",
        text,
        task: taskSnapshot(task),
      }),
    });
  };

  const receiveStream = async (input, options = {}) => {
    const activeTask = taskSnapshot(tasks.get(latestTaskId));
    let decision;
    try {
      decision = normalizePlannerDecision(await planner({ input, activeTask, tasks: [...tasks.values()].map(taskSnapshot) }));
    } catch (error) {
      emit({ type: "voice_task.planner_error", message: String(error?.message ?? error) });
      return harness.receiveStream(input, options);
    }

    if (decision.intent === "start_task") return startTask(decision, input);
    if (decision.intent === "update_active_task") return updateTask(decision);
    if (decision.intent === "check_task_status") return checkTask(decision);
    if (decision.intent === "cancel_task") return cancelTask(decision);
    if (decision.intent === "fast_chat" && decision.reply) {
      return immediateStream({
        text: decision.reply,
        result: Object.freeze({ kind: "response", text: decision.reply, route: { kind: "voice_task_fast_chat" } }),
      });
    }
    return harness.receiveStream(input, options);
  };

  const receive = async (input, options = {}) => {
    const opened = await receiveStream(input, options);
    if (!opened?.stream) return opened?.result ?? null;
    let text = "";
    for await (const chunk of opened.stream) {
      text += typeof chunk?.delta === "string" ? chunk.delta : "";
    }
    return opened.finalize?.(text) ?? Object.freeze({ kind: "response", text });
  };

  return Object.freeze({
    receive,
    receiveStream,
    tasks: () => Object.freeze([...tasks.values()].map(taskSnapshot)),
    latestTask: () => taskSnapshot(tasks.get(latestTaskId)),
  });
};

export const createOpenAiVoiceTaskPlanner = ({
  apiKey = process.env.OPENAI_API_KEY || "",
  baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  model = "gpt-5.5",
  reasoningEffort = "none",
  textVerbosity = "low",
  maxOutputTokens = 360,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!apiKey) {
    throw new Error("createOpenAiVoiceTaskPlanner requires OPENAI_API_KEY");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createOpenAiVoiceTaskPlanner requires fetchImpl");
  }
  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/responses`;
  const instructions = [
    "You are the voice task router for a StackChan avatar.",
    "Return only one JSON object. No Markdown.",
    "Classify the user's utterance into one of:",
    "- fast_chat: ordinary conversation; include a short reply only if you can answer immediately.",
    "- start_task: long-running work such as web research, Codex work, Slack/report preparation.",
    "- update_active_task: modify the latest running task, especially report_channel/delivery changes.",
    "- check_task_status: user asks progress/status.",
    "- cancel_task: user asks to stop/cancel.",
    "For start_task, include task.type, task.title, task.prompt, task.report_channel.",
    "If the user asks to search X, Twitter, x.com, posts, or tweets, set task.type to x_research and keep the X/Twitter terms in task.prompt.",
    "If the user asks for general web/current research, set task.type to web_research.",
    "For update_active_task, use task_id:'latest' unless the user specifies another task. Put delivery changes in updates.report_channel.",
    "For unused fields, use an empty string. For task/update objects, fill every key.",
    "Allowed report_channel values: voice, slack, both, none.",
    "Use concise Japanese acks such as 調べるね。 or 送るようにしておくね。",
  ].join("\n");

  return async ({ input, activeTask = null, tasks = [] } = {}) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions,
        input: JSON.stringify({
          utterance: input?.text || "",
          modality: input?.modality || "voice",
          activeTask,
          tasks,
        }),
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: reasoningEffort },
        text: createTextOptions({ verbosity: textVerbosity }),
      }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI voice task planner failed: ${response.status} ${responseText}`);
    }
    const payload = safeJsonParse(responseText);
    const outputText = extractOpenAiResponseOutputText(payload, responseText);
    const decision = safeJsonParse(outputText);
    if (!decision) {
      throw new Error("OpenAI voice task planner returned non-JSON output");
    }
    return decision;
  };
};
