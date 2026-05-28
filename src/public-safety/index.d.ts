import type { JsonObject } from "../index.js";

export interface RedactionFilter {
  redact(value: string): string;
  redactObject<T>(value: T): T;
  setTerms(terms: readonly string[]): void;
  addTerms(terms: readonly string[]): void;
  removeTerms(terms: readonly string[]): void;
  snapshot(): {
    readonly terms: readonly string[];
    readonly replacement: string;
    readonly caseSensitive: boolean;
  };
}

export function createRedactionFilter(input?: {
  readonly terms?: readonly string[];
  readonly replacement?: string;
  readonly caseSensitive?: boolean;
  readonly onRedaction?: ((event: {
    readonly hits: number;
    readonly length: number;
    readonly replacement: string;
  }) => void) | null;
}): RedactionFilter;

export interface PromptInjectionDetector {
  inspect(text: string): {
    readonly detected: boolean;
    readonly matches: readonly string[];
  };
}

export function createPromptInjectionDetector(input?: {
  readonly patterns?: readonly RegExp[];
  readonly extraPatterns?: readonly RegExp[];
}): PromptInjectionDetector;

export interface SafeFailureResult {
  readonly silent: true;
  readonly reply: unknown;
  readonly reason: string;
}

export interface SafeFailureGate {
  trigger(reason?: string, details?: JsonObject): SafeFailureResult;
  wrap<T>(label: string, fn: () => Promise<T>): Promise<T | SafeFailureResult>;
  stats(): { readonly triggers: number };
}

export function createSafeFailureGate(input?: {
  readonly silentReply?: unknown;
  readonly onTrigger?: ((event: {
    readonly reason: string;
    readonly details: JsonObject;
  }) => void) | null;
  readonly reasons?: readonly string[];
}): SafeFailureGate;

export type KillSwitchState = "running" | "paused" | "stopped";

export interface KillSwitchSnapshot {
  readonly state: KillSwitchState;
  readonly reason: string | null;
  readonly actor: string | null;
  readonly updatedAt: string;
}

export interface KillSwitch {
  readonly states: Readonly<Record<KillSwitchState, KillSwitchState>>;
  pause(input?: { readonly reason?: string | null; readonly actor?: string | null }): KillSwitchSnapshot;
  resume(input?: { readonly reason?: string | null; readonly actor?: string | null }): KillSwitchSnapshot;
  stop(input?: { readonly reason?: string | null; readonly actor?: string | null }): KillSwitchSnapshot;
  reset(input?: { readonly reason?: string | null; readonly actor?: string | null }): KillSwitchSnapshot;
  canAcceptTurn(): boolean;
  canBoot(): boolean;
  snapshot(): KillSwitchSnapshot;
}

export function createKillSwitch(input?: {
  readonly initial?: KillSwitchState;
  readonly onChange?: ((snapshot: KillSwitchSnapshot) => void) | null;
}): KillSwitch;

export interface ViewerIdentityHasher {
  hash(platform: string, platformUserId: string | number): string;
  rotateSalt(next: string): void;
  snapshot(): {
    readonly prefix: string;
    readonly saltFingerprint: string;
  };
}

export function createViewerIdentityHasher(input?: {
  readonly salt?: string;
  readonly prefix?: string;
}): ViewerIdentityHasher;

export const publicSafetyConstants: {
  readonly killStates: Readonly<Record<KillSwitchState, KillSwitchState>>;
  readonly defaultInjectionPatterns: readonly RegExp[];
};
