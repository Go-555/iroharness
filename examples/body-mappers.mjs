import {
  createCharacterState
} from "../src/index.js";
import {
  createEvenG2DisplayBridge,
  createEvenG2DisplayMapper,
  createM5StackBodyBridge,
  createM5StackFaceMapper,
  createMotionPngTuberRendererBridge,
  createMotionPngTuberMapper
} from "../src/adapters/index.js";

const speaking = createCharacterState({
  characterId: "iroha",
  mode: "speaking",
  emotion: "attentive",
  speechText: "うん、見てみるね。",
  mouth: "talking",
  motion: "speaking"
});

const mappers = [
  createMotionPngTuberMapper(),
  createM5StackFaceMapper(),
  createEvenG2DisplayMapper()
];

for (const mapper of mappers) {
  console.log(`${mapper.id}: ${mapper.mapState(speaking)}`);
}

const bodies = [
  createMotionPngTuberRendererBridge(),
  createM5StackBodyBridge(),
  createEvenG2DisplayBridge()
];

for (const body of bodies) {
  body.emit({ type: "state", state: speaking });
  console.log(`${body.id}: ${JSON.stringify(body.snapshot().payload)}`);
}
