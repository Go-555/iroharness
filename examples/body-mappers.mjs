import {
  createCharacterState
} from "../src/index.js";
import {
  createEvenG2DisplayMapper,
  createM5StackFaceMapper,
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
