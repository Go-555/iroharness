export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type Modality = "text" | "voice";

export interface CharacterProfile {
  readonly id: string;
  readonly name: string;
  readonly soul?: string | null;
  readonly identity?: string | null;
  readonly memory?: string | null;
  readonly voiceStyle?: string | null;
  readonly metadata?: JsonObject;
}

export interface CharacterState {
  readonly characterId: string;
  readonly mode: string;
  readonly emotion: string;
  readonly speechText: string | null;
  readonly taskRef: string | null;
  readonly mouth: string;
  readonly gaze: string;
  readonly motion: string;
  readonly metadata: JsonObject;
}

export interface ActorInput {
  readonly platform?: string;
  readonly platformUserId?: string;
  readonly displayName?: string;
}

export interface TurnInput {
  readonly source: string;
  readonly modality: Modality | string;
  readonly text: string;
  readonly actor?: ActorInput;
  readonly metadata?: JsonObject;
}

export interface UserRecord {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly identities: JsonObject;
  readonly permissions: readonly string[];
  readonly relationship: string;
  readonly metadata: JsonObject;
}

export interface ResolvedActor {
  readonly user: UserRecord;
  readonly identity: {
    readonly platform: string;
    readonly platformUserId: string;
    readonly displayName: string;
  };
  readonly known: boolean;
}

export interface AudienceContext {
  readonly role: string;
  readonly relationship: string;
  readonly tier: string;
  readonly actorKnown: boolean;
  readonly source: string;
  readonly modality: string;
  readonly routeKind: string;
  readonly responseDepth: string;
  readonly permissions: readonly string[];
  readonly contextScopes: readonly string[];
  readonly canDeepDiscuss: boolean;
  readonly canDelegateWork: boolean;
  readonly canManageStream: boolean;
  readonly identityStable: true;
}

export interface RouteDecision {
  readonly kind: string;
  readonly harnessId: string | null;
  readonly reason: string;
}

export interface BrainResponse {
  readonly text: string;
  readonly emotion?: string;
}

export interface BrainContext {
  readonly character: CharacterProfile;
  readonly input: TurnInput;
  readonly actor: ResolvedActor;
  readonly audience: AudienceContext;
  readonly route: RouteDecision;
  readonly state: CharacterState;
  readonly projectOs: ProjectOsSnapshot;
}

export interface Brain {
  readonly id: string;
  respond(context: BrainContext): Promise<BrainResponse> | BrainResponse;
}

export interface TicketRecord {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly acceptance: readonly string[];
  readonly ownerCharacterId: string;
  readonly executorHarnessId: string | null;
  readonly status: string;
  readonly metadata: JsonObject;
}

export interface RunRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly harnessId: string;
  readonly status: string;
  readonly input: TurnInput | JsonObject;
  readonly output: JsonValue;
}

export interface ArtifactRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly runId: string;
  readonly kind: string;
  readonly uri: string;
  readonly title: string;
}

export interface ProjectOsSnapshot {
  readonly tickets: readonly TicketRecord[];
  readonly runs: readonly RunRecord[];
  readonly artifacts: readonly ArtifactRecord[];
}

export interface BrainSummary {
  readonly slot: string;
  readonly id: string;
}

export interface ProjectOs {
  createTicket(input: {
    readonly title: string;
    readonly purpose: string;
    readonly acceptance?: readonly string[];
    readonly ownerCharacterId: string;
    readonly executorHarnessId?: string | null;
    readonly metadata?: JsonObject;
  }): TicketRecord;
  updateTicket(ticketId: string, patch: JsonObject): TicketRecord;
  createRun(input: {
    readonly ticketId: string;
    readonly harnessId: string;
    readonly input: TurnInput | JsonObject;
  }): RunRecord;
  completeRun(runId: string, output: JsonValue, status?: string): RunRecord;
  addArtifact(input: {
    readonly ticketId: string;
    readonly runId: string;
    readonly kind: string;
    readonly uri: string;
    readonly title: string;
  }): ArtifactRecord;
  snapshot(): ProjectOsSnapshot;
}

export interface UserRegistrySnapshot {
  readonly users: readonly UserRecord[];
  readonly userIdentities: readonly JsonObject[];
  readonly permissionOverrides: readonly JsonObject[];
  readonly streamSessions: readonly JsonObject[];
  readonly auditLog: readonly JsonObject[];
}

export interface UserRegistry {
  registerUser(input: JsonObject): UserRecord | Promise<UserRecord>;
  updateUser(
    userId: string,
    patch: JsonObject,
  ): UserRecord | Promise<UserRecord>;
  linkIdentity(input: JsonObject): JsonObject | Promise<JsonObject>;
  setPermissionOverride(input: JsonObject): JsonObject | Promise<JsonObject>;
  deletePermissionOverride(input: JsonObject): JsonObject | Promise<JsonObject>;
  createStreamSession(input: JsonObject): JsonObject | Promise<JsonObject>;
  updateStreamSession(
    sessionId: string,
    patch: JsonObject,
  ): JsonObject | Promise<JsonObject>;
  findByIdentity(
    actor: ActorInput,
  ): UserRecord | null | Promise<UserRecord | null>;
  resolveActor(actor: ActorInput): ResolvedActor | Promise<ResolvedActor>;
  snapshot(): UserRegistrySnapshot | Promise<UserRegistrySnapshot>;
}

export interface MicroHarnessOutput {
  readonly status: string;
  readonly summary: string;
  readonly artifacts: readonly JsonObject[];
  readonly raw?: JsonValue;
}

export interface MicroHarness {
  readonly id: string;
  readonly capabilities: readonly string[];
  run(
    ticket: TicketRecord,
    context: JsonObject,
  ): Promise<MicroHarnessOutput> | MicroHarnessOutput;
}

export interface Device {
  readonly id: string;
  readonly kind?: string;
  readonly capabilities?: readonly string[];
  emit(event: JsonObject): void;
}

export interface IroHarness {
  readonly character: CharacterProfile;
  receive(input: TurnInput): Promise<JsonObject>;
  state(): CharacterState;
  brains(): readonly BrainSummary[];
  projectOs(): ProjectOsSnapshot;
  users(): UserRegistrySnapshot | Promise<UserRegistrySnapshot>;
}

export function createCharacterState(
  input: Partial<CharacterState> & {
    readonly characterId: string;
  },
): CharacterState;

export function createFileCharacterProfile(input?: {
  readonly dir?: string;
  readonly id?: string | null;
  readonly name?: string | null;
  readonly soulFile?: string;
  readonly identityFile?: string;
  readonly memoryFile?: string;
  readonly voiceFile?: string;
  readonly metadata?: JsonObject;
}): CharacterProfile;

export function createInMemoryProjectOs(): ProjectOs;
export function createFileProjectOs(input: {
  readonly path: string;
}): ProjectOs;
export function createProjectOsMarkdown(snapshot: ProjectOsSnapshot): string;

export function createInMemoryUserRegistry(): UserRegistry;
export function createFileUserRegistry(input: {
  readonly path: string;
}): UserRegistry;
export function createPostgresUserRegistry(input: {
  readonly query: (
    sql: string,
    params?: readonly JsonValue[],
  ) => Promise<{ readonly rows: readonly JsonObject[] }>;
}): UserRegistry;

export function createPermissionPolicy(input?: JsonObject): JsonObject;
export function createAudienceContextPolicy(input?: JsonObject): JsonObject;
export function createHeuristicRouter(): JsonObject;
export function createEchoBrain(id: string): Brain;
export function createHttpBrain(input: JsonObject): Brain;

export function createRealtimeLatencyTracker(input?: JsonObject): JsonObject;
export function createRealtimeEventBus(input?: JsonObject): JsonObject;
export function createRealtimeBargeInGate(input?: JsonObject): JsonObject;
export function createJavascriptRealtimeCore(input?: JsonObject): JsonObject;
export function createRustRealtimeCoreCabiAdapter(
  input?: JsonObject,
): JsonObject;
export function createRustRealtimeCoreBinding(input?: JsonObject): JsonObject;
export function createTextStreamingStt(input?: JsonObject): JsonObject;
export function createHttpStreamingStt(input: JsonObject): JsonObject;
export function createTextStreamingTts(input?: JsonObject): JsonObject;
export function createHttpStreamingTts(input: JsonObject): JsonObject;
export function createSpeechPlaybackQueue(input?: JsonObject): JsonObject;
export function createRealtimeVoiceSession(input?: JsonObject): JsonObject;

export function createStubMicroHarness(
  id: string,
  capabilities?: readonly string[],
): MicroHarness;
export function createRecorderStreamController(id?: string): JsonObject;
export function createRecorderDevice(id: string): Device & {
  events(): readonly JsonObject[];
};
export function createConsoleDevice(id?: string): Device;

// The read-only turn context passed to a satisfiedRequirements resolver.
export interface SatisfiedRequirementsContext {
  readonly input: TurnInput;
  readonly actor: ResolvedActor;
  readonly route: RouteDecision;
  readonly audience: AudienceContext;
  readonly state: CharacterState;
  readonly permissions: readonly string[];
  readonly contextScopes: readonly string[];
}

export function createIroHarness(input: {
  readonly character: CharacterProfile;
  readonly projectOs: ProjectOs;
  readonly userRegistry?: UserRegistry;
  readonly permissionPolicy?: JsonObject;
  readonly audiencePolicy?: JsonObject;
  readonly router?: JsonObject;
  readonly brains: {
    readonly voice: Brain;
    readonly text: Brain;
  };
  readonly devices?: readonly Device[];
  readonly microHarnesses?: readonly MicroHarness[];
  readonly streamController?: JsonObject | null;
  readonly skills?: { list: () => readonly JsonValue[] } | null;
  // Static list, or a per-turn resolver, of satisfied skill `requires` conditions
  // (config/environment/platform flags like "stream.enabled"). A throwing or
  // non-array resolver is treated as none satisfied (fail-closed).
  readonly satisfiedRequirements?:
    | readonly string[]
    | ((context: SatisfiedRequirementsContext) => readonly string[]);
}): IroHarness;

export const constants: {
  readonly MODES: JsonObject;
};
