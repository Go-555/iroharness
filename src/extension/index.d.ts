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
