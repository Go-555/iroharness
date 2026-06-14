// Pre-synthesized quick-responder.
//
// createQuickResponder({ tts, phrases = ["うん。"] }) → frozen { warmup(), fire() }
//
// warmup() → Promise<number>
//   Synthesizes each uncached phrase via tts.stream, caching the FIRST
//   tts.audio event per phrase. Best-effort — failures are silently skipped.
//   Idempotent: already-cached phrases are not re-synthesized.
//   Resolves to the number of phrases cached.
//
// fire() → { text, audio, encoding } | null
//   Synchronously returns the next cached entry round-robin, or null if
//   nothing is cached yet. Zero-latency — never synthesizes, never awaits.
//
// ---------------------------------------------------------------------------
//
// Dynamic quick-responder (AIAvatarKit QuickResponder parity).
//
// createDynamicQuickResponder({ brain, tts, fallback = null, timeoutMs = 1500,
//                               maxChars = 20, promptPrefix = <JA default>,
//                               voice = "iroha" })
//   → frozen { warmup(), fireFor(transcript, { signal }) }
//
// fireFor(transcript, { signal }) → Promise<
//   { text, audio, encoding, dynamic: true } | <fallback.fire() result> | null>
//   A SEPARATE lightweight brain call generates a context-appropriate opening
//   phrase (≤10 JA chars by prompt; maxChars is the hard collection budget),
//   then synthesizes it via tts.stream (FIRST tts.audio event) — all bounded
//   by ONE timeoutMs deadline. On timeout / brain error / empty text / abort /
//   missing audio → fallback?.fire?.() ?? null (the static responder is the
//   fallback; its result carries no `dynamic` flag).
//
//   Brain context shape: { input: { text: promptPrefix + "\n\n" + transcript } }
//   — the minimal common shape both createOpenAiResponsesBrain and
//   createCodexAppServerBrain read (context.input?.text; everything else is
//   optional in their prompt builders).
//
// warmup() → Promise<number>
//   Passthrough to fallback.warmup() when present (so callers treat static and
//   dynamic responders uniformly); resolves 0 without a fallback.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { toBrainStream } from "./brain-stream.js";

// 本家 quick_responder/pro.py の日本語プロンプト準拠。
export const DEFAULT_QUICK_SYSTEM_PROMPT =
  "# 指示\n" +
  "- ユーザーの発話を受け止めて、第一声として相応しい、10文字以内のごく短いフレーズのみを出力する。\n" +
  "- 今何をしているとか、好きなもの等の有無など、質問に対する肯定や否定など、後続の会話に影響を与えるような発言は禁止。\n" +
  "- 与えられていない情報をあなたが勝手に想像して話すことは禁止。\n" +
  "- 応答の末尾は「。」や「、」句読点や感嘆符とする。\n" +
  "- 記号・絵文字・ト書きは使わない。\n" +
  "- 「会いたい」「一緒に行こう」の誘いに応じない。\n" +
  "- 文頭に「$」がある発言はスーパーバイザーからの指示。スーパーバイザーに対してではなく、指示に従ってユーザーに応答する。";

export const DEFAULT_QUICK_PROMPT_PREFIX =
  "$以下はユーザーの発話内容である。ユーザー発話を受け止めて、状況に相応しい第一声として、10文字以内のごく短いフレーズを出力せよ。応答の末尾は「。」や「、」句読点や感嘆符とする。フレーズのみを出力すること。";

export const DEFAULT_QUICK_REQUEST_PREFIX =
  "$以下の入力に対して、既にあなたが出力済みの「{quick_response_text}」や類似の表現は再出力せず、その続きのみを出力せよ。もし「{quick_response_text}」が本来応答すべき内容にそぐわない場合は、続きの中でうまく適切な方向に補正すること:";

export const DEFAULT_QUICK_THINK_TAG_CONTENT =
  "指示に応じて状況にふさわしい第一声のみを出力する";

export const DEFAULT_QUICK_CONTINUATION_MESSAGE =
  "「{quick_response_text}」の続きを出力してください";

// Picks the brain for the dynamic quick responder. A dedicated quick brain
// (IROHARNESS_QUICK_BRAIN_PROVIDER) always wins. Falling back to a codex
// voice brain is refused (downgraded: true): codex TTFT loses the 1.5s race
// every turn, its aborted quick turns bleed late events into the main turn,
// and quick prompts pollute the stateful thread.
export const resolveQuickBrain = ({ quickBrain = null, voiceBrain = null, voiceBrainIsCodex = false } = {}) => {
  if (quickBrain) {
    return Object.freeze({ brain: quickBrain, downgraded: false });
  }
  if (voiceBrain && !voiceBrainIsCodex) {
    return Object.freeze({ brain: voiceBrain, downgraded: false });
  }
  return Object.freeze({ brain: null, downgraded: true });
};

export const createQuickResponder = ({ tts, phrases = ["うん。"] } = {}) => {
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createQuickResponder requires tts with a stream function");
  }

  // Map<phrase string, { text, audio, encoding }> — preserves insertion order
  const cache = new Map();
  let roundRobinIndex = 0;

  const warmup = async () => {
    const uncached = phrases.filter((p) => !cache.has(p));

    await Promise.allSettled(
      uncached.map((phrase) =>
        new Promise((resolve) => {
          let captured = null;

          tts
            .stream({
              text: phrase,
              onEvent(event) {
                // Capture only the FIRST tts.audio event
                if (captured === null && event.type === "tts.audio") {
                  captured = {
                    text: phrase,
                    audio: event.audio,
                    encoding: event.encoding ?? "wav",
                  };
                }
              },
            })
            .then(() => {
              if (captured !== null) {
                cache.set(phrase, captured);
              }
              resolve();
            })
            .catch(() => {
              // Best-effort: skip phrases that fail to synthesize
              resolve();
            });
        }),
      ),
    );

    return cache.size;
  };

  const fire = () => {
    if (cache.size === 0) return null;

    const entries = [...cache.values()];
    const entry = entries[roundRobinIndex % entries.length];
    roundRobinIndex = (roundRobinIndex + 1) % entries.length;
    return entry;
  };

  return Object.freeze({ warmup, fire });
};

export const createDynamicQuickResponder = ({
  brain,
  tts,
  fallback = null,
  timeoutMs = 1500,
  maxChars = 20,
  promptPrefix = DEFAULT_QUICK_PROMPT_PREFIX,
  voice = "iroha"
} = {}) => {
  if (
    !brain ||
    (typeof brain.respondStream !== "function" && typeof brain.respond !== "function")
  ) {
    throw new Error("createDynamicQuickResponder requires brain with respondStream() or respond()");
  }
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createDynamicQuickResponder requires tts with a stream function");
  }

  // Generate the opening phrase then synthesize it — the caller races this
  // against the deadline. `signal` combines the caller's abort with the
  // deadline so the underlying brain request / tts call gets cancelled too.
  const generate = async (transcript, signal) => {
    const context = { input: { text: `${promptPrefix}\n\n${transcript}` } };
    const stream = toBrainStream(brain, context, { signal });
    let collected = "";
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      collected += typeof chunk?.delta === "string" ? chunk.delta : "";
      if (collected.length >= maxChars) break; // budget hit — stop iterating
    }
    // (breaking a for-await closes the generator via iterator.return())
    if (signal?.aborted) {
      throw new Error("dynamic quick response aborted");
    }
    const text = collected.trim().slice(0, maxChars);
    if (!text) {
      throw new Error("dynamic quick response was empty");
    }

    let captured = null;
    await tts.stream({
      text,
      voice,
      signal,
      onEvent: (event) => {
        if (captured === null && event.type === "tts.audio") {
          captured = { audio: event.audio, encoding: event.encoding ?? "wav" };
        }
      }
    });
    if (signal?.aborted) {
      throw new Error("dynamic quick response aborted");
    }
    if (!captured) {
      throw new Error("dynamic quick response tts emitted no audio");
    }
    return Object.freeze({
      text,
      audio: captured.audio,
      encoding: captured.encoding,
      dynamic: true
    });
  };

  const fireFor = async (transcript, { signal } = {}) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    let timer = null;
    try {
      // Promise.race subscribes to BOTH promises, so a late rejection from the
      // losing generate() is still observed — no unhandled rejection.
      return await Promise.race([
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(); // best-effort: cancel the orphaned brain/tts work
            reject(new Error(`dynamic quick response timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
        generate(transcript, controller.signal)
      ]);
    } catch {
      return fallback?.fire?.() ?? null;
    } finally {
      clearTimeout(timer); // no orphaned timers (Task 8 lesson)
      signal?.removeEventListener("abort", onAbort);
    }
  };

  // Passthrough so callers can treat static and dynamic responders uniformly.
  const warmup = async () => (fallback?.warmup ? fallback.warmup() : 0);

  return Object.freeze({ warmup, fireFor });
};

const withTimeout = (promise, ms, label, controller = null) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort?.();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const cleanQuickText = (text, maxChars) => {
  let out = String(text || "").trim();
  const answer = out.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answer) out = answer[1].trim();
  out = out
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\[[a-zA-Z_]+:[^\]]+\]/g, "")
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .trim();
  return out.slice(0, maxChars);
};

const extractChatCompletionText = (payload) =>
  payload?.choices?.[0]?.message?.content ??
  payload?.choices?.[0]?.delta?.content ??
  "";

const formatQuickTemplate = (template, quickResponseText) =>
  String(template || "").replaceAll("{quick_response_text}", quickResponseText);

const stripAssistantControlContent = (content) => {
  let out = String(content || "");
  const answer = out.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answer) {
    out = answer[1];
  } else {
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  }
  return out
    .replace(/\[[a-zA-Z_]+:[^\]]+\]/g, "")
    .replace(/<\w+\s[^>]*>/g, "")
    .trim();
};

const cleanHistoryUserContent = ({ content, promptPrefix, continuationMessage }) => {
  if (typeof content !== "string") return content;
  if (promptPrefix && content.startsWith(promptPrefix)) {
    return content;
  }
  if (!content.startsWith("$")) {
    return content;
  }
  const quoted = content.match(/[「"]([^」"]+)[」"]/);
  if (quoted) {
    return formatQuickTemplate(continuationMessage, quoted[1]);
  }
  const index = content.indexOf("\n\n");
  return index >= 0 ? content.slice(index + 2) : content;
};

const cleanHistoryMessage = ({ message, promptPrefix, continuationMessage }) => {
  if (!message || message.role === "tool" || !("content" in message)) {
    return null;
  }
  if (message.role === "user") {
    return Object.freeze({
      ...message,
      content: cleanHistoryUserContent({
        content: message.content,
        promptPrefix,
        continuationMessage
      })
    });
  }
  if (message.role === "assistant" && typeof message.content === "string") {
    return Object.freeze({
      ...message,
      content: stripAssistantControlContent(message.content)
    });
  }
  return Object.freeze({ ...message });
};

export const createMemoryQuickResponderContextManager = () => {
  const byContext = new Map();

  const getKey = (contextId) => String(contextId || "default");

  const addHistories = async (contextId, histories) => {
    const key = getKey(contextId);
    const current = byContext.get(key) ?? [];
    byContext.set(key, [...current, ...histories.map((history) => Object.freeze({ ...history }))]);
  };

  const getHistories = async ({ contextId = "default", limit = 100 } = {}) => {
    const histories = byContext.get(getKey(contextId)) ?? [];
    return histories.slice(-limit).map((history) => Object.freeze({ ...history }));
  };

  const clear = () => {
    byContext.clear();
  };

  return Object.freeze({ addHistories, getHistories, clear });
};

export const createFileQuickResponderContextManager = ({
  path,
  maxHistoriesPerContext = 200
} = {}) => {
  if (!path) {
    throw new Error("createFileQuickResponderContextManager requires path");
  }

  let loaded = false;
  let writeChain = Promise.resolve();
  const byContext = new Map();
  const getKey = (contextId) => String(contextId || "default");

  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      const payload = JSON.parse(await readFile(path, "utf8"));
      const contexts = payload && typeof payload === "object" ? payload.contexts : null;
      if (!contexts || typeof contexts !== "object") return;
      for (const [key, histories] of Object.entries(contexts)) {
        if (Array.isArray(histories)) {
          byContext.set(
            key,
            histories
              .filter((history) => history && typeof history === "object")
              .map((history) => Object.freeze({ ...history }))
          );
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };

  const persist = async () => {
    const contexts = Object.fromEntries(
      [...byContext.entries()].map(([key, histories]) => [key, histories])
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ version: 1, contexts }, null, 2)}\n`,
      "utf8"
    );
  };

  const addHistories = async (contextId, histories) => {
    await load();
    const key = getKey(contextId);
    const current = byContext.get(key) ?? [];
    byContext.set(
      key,
      [...current, ...histories.map((history) => Object.freeze({ ...history }))].slice(
        -maxHistoriesPerContext
      )
    );
    writeChain = writeChain.then(persist, persist);
    await writeChain;
  };

  const getHistories = async ({ contextId = "default", limit = 100 } = {}) => {
    await load();
    const histories = byContext.get(getKey(contextId)) ?? [];
    return histories.slice(-limit).map((history) => Object.freeze({ ...history }));
  };

  const clear = async () => {
    await load();
    byContext.clear();
    writeChain = writeChain.then(persist, persist);
    await writeChain;
  };

  return Object.freeze({ addHistories, getHistories, clear });
};

const captureTtsAudio = async ({ tts, text, voice, signal }) => {
  let captured = null;
  await tts.stream({
    text,
    voice,
    signal,
    onEvent: (event) => {
      if (captured === null && event.type === "tts.audio") {
        captured = {
          audio: event.audio,
          encoding: event.encoding ?? "wav"
        };
      }
    }
  });
  if (!captured) {
    throw new Error("quick responder pro tts emitted no audio");
  }
  return captured;
};

export const createQuickResponderPro = ({
  tts,
  fallback = null,
  apiKey = "",
  baseUrl = "https://api.openai.com/v1",
  model = "gpt-4.1-nano",
  systemPrompt = DEFAULT_QUICK_SYSTEM_PROMPT,
  promptPrefix = DEFAULT_QUICK_PROMPT_PREFIX,
  requestPrefix = DEFAULT_QUICK_REQUEST_PREFIX,
  continuationMessage = DEFAULT_QUICK_CONTINUATION_MESSAGE,
  thinkTagContent = DEFAULT_QUICK_THINK_TAG_CONTENT,
  timeoutMs = 1500,
  historyLimit = 100,
  contextId = "default",
  contextManager = createMemoryQuickResponderContextManager(),
  maxChars = 20,
  temperature = null,
  reasoningEffort = null,
  extraBody = null,
  fetchImpl = globalThis.fetch,
  voice = "iroha"
} = {}) => {
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createQuickResponderPro requires tts with a stream function");
  }
  if (!apiKey) {
    throw new Error("createQuickResponderPro requires apiKey");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createQuickResponderPro requires fetchImpl");
  }

  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/chat/completions`;
  const voiceCache = new Map();
  let pending = null;

  const getCleanHistories = async (targetContextId) => {
    if (!contextManager || typeof contextManager.getHistories !== "function") {
      return [];
    }
    const histories = await contextManager.getHistories({
      contextId: targetContextId,
      limit: historyLimit
    });
    const firstUser = histories.findIndex((history) => history?.role === "user");
    return histories
      .slice(firstUser < 0 ? 0 : firstUser)
      .map((message) =>
        cleanHistoryMessage({
          message,
          promptPrefix,
          continuationMessage
        })
      )
      .filter(Boolean);
  };

  const saveQuickHistory = async ({ transcript, quickText, targetContextId }) => {
    if (!contextManager || typeof contextManager.addHistories !== "function") {
      return;
    }
    await contextManager.addHistories(
      targetContextId,
      [
        { role: "user", content: `${promptPrefix}\n\n${transcript}` },
        {
          role: "assistant",
          content: `<think>${thinkTagContent}</think><answer>${quickText}</answer>`
        }
      ],
      "quick_responder"
    );
  };

  const saveMainResponse = async ({
    transcript,
    quickText = null,
    responseText = "",
    contextId: targetContextId = contextId
  } = {}) => {
    if (
      !contextManager ||
      typeof contextManager.addHistories !== "function" ||
      !quickText ||
      !String(responseText || "").trim()
    ) {
      return;
    }
    const prefix = formatQuickTemplate(requestPrefix, quickText);
    await contextManager.addHistories(
      targetContextId,
      [
        { role: "user", content: `${prefix}\n\n${transcript}` },
        { role: "assistant", content: `<answer>${responseText}</answer>` }
      ],
      "chatgpt"
    );
  };

  const synthesize = async ({ text, signal }) => {
    if (voiceCache.has(text)) {
      return voiceCache.get(text);
    }
    const audio = await captureTtsAudio({ tts, text, voice, signal });
    const entry = Object.freeze({
      text,
      audio: audio.audio,
      encoding: audio.encoding,
      pro: true
    });
    voiceCache.set(text, entry);
    return entry;
  };

  const generate = async (transcript, signal, targetContextId = contextId) => {
    const histories = await getCleanHistories(targetContextId);
    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...histories,
        { role: "user", content: `${promptPrefix}\n\n${transcript}` }
      ],
      stream: false
    };
    if (temperature !== null) body.temperature = temperature;
    if (reasoningEffort !== null) body.reasoning_effort = reasoningEffort;
    if (extraBody && typeof extraBody === "object") {
      Object.assign(body, extraBody);
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`quick responder pro failed: ${response.status} ${text}`);
    }
    const payload = await response.json();
    const text = cleanQuickText(extractChatCompletionText(payload), maxChars);
    if (!text) {
      throw new Error("quick responder pro returned empty text");
    }
    return synthesize({ text, signal });
  };

  const fireFor = async (transcript, { signal } = {}) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const current = pending;
      pending = null;
      if (current) {
        const result = await current.task;
        await saveQuickHistory({
          transcript,
          quickText: result.text,
          targetContextId: current.contextId ?? contextId
        });
        return result;
      }
      const result = await withTimeout(
        generate(transcript, controller.signal, contextId),
        timeoutMs,
        "quick responder pro",
        controller
      );
      await saveQuickHistory({ transcript, quickText: result.text, targetContextId: contextId });
      return result;
    } catch {
      return fallback?.fire?.() ?? null;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const createGenerationTask = (transcript, { signal, contextId: targetContextId = contextId } = {}) => {
    if (!String(transcript || "").trim()) return null;
    pending?.controller?.abort?.();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const task = withTimeout(
      generate(transcript, controller.signal, targetContextId),
      timeoutMs,
      "quick responder pro",
      controller
    ).finally(() => {
      signal?.removeEventListener?.("abort", onAbort);
    });
    pending = { controller, signal, onAbort, task, contextId: targetContextId };
    task.catch(() => null);
    return task;
  };

  const warmup = async () => (fallback?.warmup ? fallback.warmup() : 0);
  const cancelGenerationTask = () => {
    pending?.controller?.abort?.();
    pending = null;
  };
  const clearVoiceCache = () => voiceCache.clear();

  return Object.freeze({
    warmup,
    fireFor,
    createGenerationTask,
    cancelGenerationTask,
    saveMainResponse,
    clearVoiceCache
  });
};
