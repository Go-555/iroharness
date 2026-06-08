export type HookStyle = "inprocess" | "command" | "agent";

export interface HookDecision {
  block?: { reason?: string };
  transform?: Record<string, unknown>;
}

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
    handler: (context: Record<string, unknown>) => HookDecision | undefined,
    options?: { style?: HookStyle; priority?: number },
  ): HookRegistry;
  dispatch(
    event: string,
    context?: Record<string, unknown>,
  ): HookDispatchResult;
}

export function createHookRegistry(): HookRegistry;

export const REALTIME_HOOK_EVENTS: ReadonlySet<string>;
