export type HookStyle = "inprocess" | "command" | "agent";

export interface HookDecision {
  block?: { reason?: string };
  transform?: Record<string, unknown>;
}

// A handler returns a decision (or `undefined` to pass through), synchronously
// (in-process) or as a Promise (command/agent hooks). `dispatch` awaits either.
export type HookHandler = (
  context: Record<string, unknown>,
) => HookDecision | undefined | Promise<HookDecision | undefined>;

export interface HookDispatchResult {
  event: string;
  blocked: boolean;
  reason: string | null;
  context: Record<string, unknown>;
}

export interface HookRegistry {
  kind: "hook-registry";
  register(
    event: string,
    handler: HookHandler,
    options?: { style?: HookStyle; priority?: number },
  ): HookRegistry;
  dispatch(
    event: string,
    context?: Record<string, unknown>,
    options?: { protectedKeys?: readonly string[] },
  ): Promise<HookDispatchResult>;
}

export function createHookRegistry(): HookRegistry;

export const REALTIME_HOOK_EVENTS: ReadonlySet<string>;

export interface CommandHookSpec {
  command: string;
  args?: string[];
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export function createCommandHook(spec: CommandHookSpec): HookHandler;

// A brain following the standard brain contract; only `respond` is required
// by the judge path.
export interface JudgeBrain {
  id?: string;
  respond(context: Record<string, unknown>): Promise<{ text?: string }>;
}

export interface Rubric {
  items: ReadonlyArray<{ id: string; kind: string; instruction: string }>;
}

// Exactly one of `rubric` / `prompt` provides the scoring criteria. With no
// `judgeBrain` injected (e.g. a manifest-declared hook before injection) the
// hook follows `failMode` when it fires; the default is "open" so a missing or
// failing judge never mutes the character (persona-guard.md §6).
export interface AgentHookSpec {
  judgeBrain?: JudgeBrain | null;
  rubric?: Rubric | null;
  prompt?: string | null;
  timeout?: number;
  failMode?: "open" | "closed";
  model?: string | null;
}

export function createAgentHook(spec: AgentHookSpec): HookHandler;

export interface PersonaGuardHookSpec {
  character: Record<string, unknown>;
  judgeBrain?: JudgeBrain | null;
  timeout?: number;
  failMode?: "open" | "closed";
  model?: string | null;
}

export function createPersonaGuardHook(spec: PersonaGuardHookSpec): HookHandler;

export interface CommandManifestEntry {
  type: "command";
  command: string;
  matcher?: string;
  args?: string[];
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  priority?: number;
}

// Phase 8: a manifest DECLARES an agent hook (prompt/model/timeout); the
// judge brain is only ever injected from code via the loader's `judgeBrain`
// option. Without an injected brain the hook fires fail-open.
export interface AgentManifestEntry {
  type: "agent";
  prompt: string;
  matcher?: string;
  model?: string;
  timeout?: number;
  priority?: number;
}

export type HookManifestEntry = CommandManifestEntry | AgentManifestEntry;

export interface CommandManifest {
  hooks?: Record<string, HookManifestEntry[]>;
}

export function registerCommandManifest(
  registry: HookRegistry,
  manifest: CommandManifest,
  options?: { baseDir?: string; judgeBrain?: JudgeBrain | null },
): HookRegistry;

export function loadCommandManifestFile(
  registry: HookRegistry,
  path: string,
  options?: { judgeBrain?: JudgeBrain | null },
): HookRegistry;
