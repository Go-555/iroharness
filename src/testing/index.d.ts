import type { Brain, Device, JsonObject, MicroHarness } from "../index.js";

export function assertMicroHarnessContract(
  microHarness: MicroHarness,
  input: {
    readonly task: JsonObject;
    readonly context: JsonObject;
  }
): Promise<JsonObject>;

export function assertDeviceContract(
  device: Device,
  input: {
    readonly events: readonly JsonObject[];
  }
): Promise<JsonObject>;

export function assertBrainContract(
  brain: Brain,
  input: {
    readonly context: JsonObject;
  }
): Promise<JsonObject>;
