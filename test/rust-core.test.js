import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workspaceToml = () => readFileSync(join(process.cwd(), "Cargo.toml"), "utf8");
const coreToml = () =>
  readFileSync(join(process.cwd(), "crates", "realtime-core", "Cargo.toml"), "utf8");
const coreSource = () =>
  readFileSync(join(process.cwd(), "crates", "realtime-core", "src", "lib.rs"), "utf8");
const jsonlSource = () =>
  readFileSync(
    join(process.cwd(), "crates", "realtime-core", "src", "bin", "jsonl.rs"),
    "utf8"
  );

test("Rust workspace includes realtime core crate", () => {
  assert.match(workspaceToml(), /members = \["crates\/realtime-core"\]/);
  assert.match(coreToml(), /name = "iroharness-realtime-core"/);
  assert.match(coreToml(), /edition = "2021"/);
});

test("Rust realtime core defines event, audio, device, latency, and barge-in contracts", () => {
  const source = coreSource();

  [
    "RealtimeEventKind",
    "RealtimeEvent",
    "AudioChunk",
    "DeviceCommand",
    "RealtimeBus",
    "BargeInGate",
    "LatencyTracker"
  ].forEach((symbol) => {
    assert.match(source, new RegExp(`(?:struct|enum) ${symbol}`));
  });

  assert.match(source, /TtsInterrupted/);
  assert.match(source, /observe_stt_partial/);
  assert.match(source, /bus_keeps_bounded_events/);
  assert.match(source, /barge_in_gate_interrupts_speaking_on_partial_text/);
});

test("Rust realtime core exposes a JSONL process binary", () => {
  const toml = coreToml();
  const source = jsonlSource();

  assert.match(toml, /\[\[bin\]\]/);
  assert.match(toml, /name = "iroharness-realtime-core-jsonl"/);
  assert.match(source, /fn main\(\)/);
  assert.match(source, /RealtimeBus::new/);
  assert.match(source, /BargeInGate::default/);
  assert.match(source, /LatencyTracker::new/);
  assert.match(source, /"publish"/);
  assert.match(source, /"shouldInterrupt"/);
  assert.match(source, /ack/);
});
