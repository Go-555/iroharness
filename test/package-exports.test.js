import assert from "node:assert/strict";
import test from "node:test";

import {
  createEchoBrain,
  createInMemoryProjectOs,
  createIroHarness
} from "iroharness";
import {
  createDiscordMessageAdapter,
  createEventStreamDevice
} from "iroharness/adapters";
import { assertBrainContract } from "iroharness/testing";

test("package exports resolve public core, adapter, and testing entrypoints", async () => {
  const harness = createIroHarness({
    character: {
      id: "iroha",
      name: "Iroha"
    },
    projectOs: createInMemoryProjectOs(),
    brains: {
      voice: createEchoBrain("voice-fast"),
      text: createEchoBrain("text-standard")
    },
    devices: [createEventStreamDevice("events")]
  });
  const adapter = createDiscordMessageAdapter();
  const turn = adapter.normalize({
    id: "message_1",
    channel_id: "channel_1",
    content: "こんにちは",
    author: {
      id: "discord-user-1",
      username: "Fan One"
    }
  });
  const contract = await assertBrainContract(createEchoBrain("contract-brain"), {
    context: {
      character: {
        id: "iroha",
        name: "Iroha"
      },
      input: {
        source: "test",
        modality: "text",
        text: "hello"
      },
      route: {
        kind: "text"
      }
    }
  });

  assert.equal(harness.character.id, "iroha");
  assert.equal(turn.actor.platform, "discord");
  assert.equal(contract.adapterId, "contract-brain");
});
