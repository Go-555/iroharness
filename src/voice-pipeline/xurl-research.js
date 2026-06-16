import { spawn } from "node:child_process";

const normalizeText = (value, fallback = "") =>
  String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim();

const truncateText = (value, maxLength = 20_000) => {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
};

const clamp = (value, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
};

export const shouldUseXurlResearch = ({ task = {}, input = {}, text = "" } = {}) => {
  const haystack = [
    task.type,
    task.title,
    task.prompt,
    input.text,
    text,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return (
    haystack.includes("x_research") ||
    haystack.includes("twitter_research") ||
    haystack.includes("xurl") ||
    haystack.includes("twitter") ||
    haystack.includes("ツイッター") ||
    haystack.includes("x.com") ||
    /(^|[\s、。,.「『])x[でのをに\s、。,.]/i.test(haystack) ||
    /(^|[\s、。,.「『])x\s*検索/i.test(haystack)
  );
};

export const buildXurlSearchQuery = ({ task = {}, input = {} } = {}) => {
  const source = normalizeText(task.prompt || input.text || task.title || "");
  const cleaned = source
    .replace(/(?:^|\s)(?:いろは|stackchan)[、,\s]*/gi, " ")
    .replace(/(?:x|twitter|ツイッター)(?:で|の|を|に)?/gi, " ")
    .replace(/(?:調べて|調べる|検索して|検索|リサーチして|リサーチ|まとめて|結果|slackに送って|送っておいて)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateText(cleaned || source || "AI", 180);
};

const runCommand = ({
  command,
  args,
  timeoutMs,
  spawnImpl,
}) =>
  new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill?.("SIGTERM");
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: `xurl timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("close", (code) => {
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: code === 0 ? "" : stderr || stdout || `xurl exited with ${code}`,
      });
    });
  });

export const createXurlReadOnlyResearchRunner = ({
  command = process.env.IROHARNESS_XURL_COMMAND || "xurl",
  maxResults = Number(process.env.IROHARNESS_XURL_MAX_RESULTS || "10"),
  timeoutMs = Number(process.env.IROHARNESS_XURL_TIMEOUT_MS || "15000"),
  spawnImpl = spawn,
} = {}) => {
  const normalizedMaxResults = clamp(maxResults, 10, 100);
  const normalizedTimeoutMs = clamp(timeoutMs, 1000, 120_000);
  const search = async ({ query }) => {
    const normalizedQuery = normalizeText(query, "AI");
    const result = await runCommand({
      command,
      args: ["search", normalizedQuery, "-n", String(normalizedMaxResults)],
      timeoutMs: normalizedTimeoutMs,
      spawnImpl,
    });
    return Object.freeze({
      ok: result.ok,
      query: normalizedQuery,
      command,
      args: Object.freeze(["search", normalizedQuery, "-n", String(normalizedMaxResults)]),
      stdout: truncateText(result.stdout),
      stderr: truncateText(result.stderr),
      error: truncateText(result.error || ""),
      code: result.code,
    });
  };
  return Object.freeze({
    id: "xurl-readonly-research",
    command,
    maxResults: normalizedMaxResults,
    timeoutMs: normalizedTimeoutMs,
    search,
  });
};

export const createXurlResearchContext = ({ xurlResult }) => {
  if (!xurlResult) return "";
  if (xurlResult.ok) {
    return [
      "XURL_SEARCH_RESULT:",
      `query: ${xurlResult.query}`,
      "The following is raw read-only output from xurl search. Use it as primary X evidence and summarize in Japanese.",
      xurlResult.stdout || "(empty)",
    ].join("\n");
  }
  return [
    "XURL_SEARCH_FAILED:",
    `query: ${xurlResult.query}`,
    `error: ${xurlResult.error || xurlResult.stderr || "unknown error"}`,
    "If X-specific search is required, explain that xurl search is not authorized yet. If a broader answer is still useful, use available web_search fallback and clearly distinguish it from X API search.",
  ].join("\n");
};
