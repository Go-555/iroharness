import type {
  Device,
  JsonObject,
  JsonValue,
  MicroHarness,
  TurnInput
} from "../index.js";

export interface PlatformAdapter {
  readonly platform: string;
  normalize(payload: JsonValue): TurnInput | null;
}

export interface BodyBridgeDevice extends Device {
  snapshot(): JsonObject | null;
  payloads(): readonly JsonObject[];
  connect(request: JsonObject, response: JsonObject): void;
}

export function createHttpMicroHarness(input: JsonObject): MicroHarness;
export function createOpenClawMicroHarness(input: JsonObject): MicroHarness;
export function createHermesGatewayMicroHarness(input: JsonObject): MicroHarness;
export function createCodexAppServerBrain(input: JsonObject): JsonObject;
export function createCodexAppServerMicroHarness(input: JsonObject): MicroHarness;
export function createScopedWorkRunnerMicroHarness(input: JsonObject): MicroHarness;
export function createJsonlProcessMicroHarness(input: JsonObject): MicroHarness;
export function createTextProcessMicroHarness(input: JsonObject): MicroHarness;
export function createClaudeCodeCliMicroHarness(input: JsonObject): MicroHarness;

export function createAIAvatarKitBridgeDevice(input?: JsonObject): Device;
export function createMotionPngTuberMapper(input?: JsonObject): JsonObject;
export function createMotionPngTuberRendererBridge(input?: JsonObject): BodyBridgeDevice;
export function createM5StackFaceMapper(input?: JsonObject): JsonObject;
export function createM5StackBodyBridge(input?: JsonObject): BodyBridgeDevice;
export function createEvenG2DisplayMapper(input?: JsonObject): JsonObject;
export function createEvenG2DisplayBridge(input?: JsonObject): BodyBridgeDevice;
export function createLive2DMapper(input?: JsonObject): JsonObject;
export function createLive2DBodyBridge(input?: JsonObject): BodyBridgeDevice;
export function createVrmMapper(input?: JsonObject): JsonObject;
export function createVrmBodyBridge(input?: JsonObject): BodyBridgeDevice;
export function createMappedBodyBridgeDevice(input: JsonObject): BodyBridgeDevice;

export function createEventStreamDevice(id?: string): Device & {
  connect(request: JsonObject, response: JsonObject): void;
  events(): readonly JsonObject[];
};

export function createDiscordMessageAdapter(input?: JsonObject): PlatformAdapter;
export function createSlackMessageAdapter(input?: JsonObject): PlatformAdapter;
export function createYouTubeLiveChatAdapter(): PlatformAdapter;
export function createVsCodeCompanionAdapter(input?: JsonObject): JsonObject;
export function createVsCodeCompanionWebviewHtml(input: JsonObject): string;
export function createPlatformAdapterRegistry(adapters: readonly PlatformAdapter[]): JsonObject;

export function createSnapshotStreamSessionResolver(input: JsonObject): JsonObject;
export function createStreamContextEnricher(input: JsonObject): (turn: TurnInput) => Promise<TurnInput>;
export function createDiscordBotRuntime(input: JsonObject): JsonObject;
export function createSlackEventsRuntime(input: JsonObject): JsonObject;
export function createYouTubeLiveChatPollingRuntime(input: JsonObject): JsonObject;

export function createObsWebSocketAdapter(input?: JsonObject): JsonObject;
export function createObsStreamController(input: JsonObject): JsonObject;
export function createJsonlRealtimeCoreProcess(input: JsonObject): JsonObject;

export function createIroHarnessDevServerHandler(input: JsonObject): (request: JsonObject, response: JsonObject) => Promise<void>;
export function createIroHarnessDevServer(input: JsonObject): JsonObject;
