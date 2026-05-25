import {
  createObsStreamController,
  createObsWebSocketAdapter
} from "../src/adapters/index.js";

const obs = createObsWebSocketAdapter({
  url: process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455",
  password: process.env.OBS_WEBSOCKET_PASSWORD || null
});

const inputName = process.env.OBS_OVERLAY_INPUT || "IroHarness Overlay";
const overlayUrl =
  process.env.IROHARNESS_OVERLAY_URL || "http://127.0.0.1:4178/?view=overlay";
const controller = createObsStreamController({
  obs,
  overlayInputName: inputName,
  overlayUrl,
  overlayWidth: Number(process.env.OBS_OVERLAY_WIDTH || 1280),
  overlayHeight: Number(process.env.OBS_OVERLAY_HEIGHT || 720),
  defaultSceneName: process.env.OBS_SCENE_NAME || null
});

try {
  const overlayOutput = await controller.execute({
    input: {
      text: "overlayを更新して",
      metadata: {
        obsAction: "overlay"
      }
    },
    route: { kind: "stream" },
    actor: { user: { id: "local-operator" } }
  });

  const sceneOutput = process.env.OBS_SCENE_NAME
    ? await controller.execute({
        input: {
          text: "OBS sceneを切り替えて",
          metadata: {
            obsAction: "scene"
          }
        },
        route: { kind: "stream" },
        actor: { user: { id: "local-operator" } }
      })
    : null;

  console.log(
    JSON.stringify({
      inputName,
      overlayUrl,
      sceneName: process.env.OBS_SCENE_NAME || null,
      overlayStatus: overlayOutput.status,
      sceneStatus: sceneOutput?.status || null
    })
  );
} catch (error) {
  console.error(`OBS control failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  controller.close();
}
