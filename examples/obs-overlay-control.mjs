import { createObsWebSocketAdapter } from "../src/adapters/index.js";

const obs = createObsWebSocketAdapter({
  url: process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455",
  password: process.env.OBS_WEBSOCKET_PASSWORD || null
});

const inputName = process.env.OBS_OVERLAY_INPUT || "IroHarness Overlay";
const overlayUrl =
  process.env.IROHARNESS_OVERLAY_URL || "http://127.0.0.1:4178/?view=overlay";

try {
  await obs.setInputSettings(inputName, {
    url: overlayUrl,
    width: Number(process.env.OBS_OVERLAY_WIDTH || 1280),
    height: Number(process.env.OBS_OVERLAY_HEIGHT || 720)
  });

  if (process.env.OBS_SCENE_NAME) {
    await obs.setCurrentProgramScene(process.env.OBS_SCENE_NAME);
  }

  console.log(
    JSON.stringify({
      inputName,
      overlayUrl,
      sceneName: process.env.OBS_SCENE_NAME || null
    })
  );
} catch (error) {
  console.error(`OBS control failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  obs.close();
}
