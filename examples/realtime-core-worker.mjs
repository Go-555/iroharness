import { createInterface } from "node:readline";

let speaking = false;
let interrupted = false;
const marks = {};

const reply = (message) => {
  console.log(JSON.stringify(message));
};

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.op === "startSpeaking") {
    speaking = true;
    interrupted = false;
  }
  if (message.op === "finishSpeaking") {
    speaking = false;
  }
  if (message.op === "mark") {
    marks[message.mark.name] = message.mark.at;
  }
  if (message.op === "shouldInterrupt") {
    interrupted = Boolean(message.result);
  }
  reply({
    type: "ack",
    op: message.op,
    coreId: message.coreId,
    sequence: message.sequence,
    eventType: message.event?.type || null,
    speaking,
    interrupted,
    marks
  });
});
