# OBS Integration

IroHarness can render a browser avatar overlay and control OBS through
obs-websocket v5.

## Browser Source

Run the browser demo:

```bash
npm run demo:browser
```

Add an OBS Browser Source pointing to:

```text
http://127.0.0.1:4178/?view=overlay
```

The overlay hides controls and uses a transparent background.

## WebSocket Control

Enable OBS WebSocket in OBS, then run:

```bash
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455 \
OBS_WEBSOCKET_PASSWORD=... \
OBS_OVERLAY_INPUT="IroHarness Overlay" \
IROHARNESS_OVERLAY_URL="http://127.0.0.1:4178/?view=overlay" \
npm run example:obs
```

This updates the Browser Source URL and, if `OBS_SCENE_NAME` is set, switches to
that scene.

## Programmatic Use

```js
import { createObsWebSocketAdapter } from "iroharness/adapters";

const obs = createObsWebSocketAdapter({
  url: "ws://127.0.0.1:4455",
  password: process.env.OBS_WEBSOCKET_PASSWORD
});

await obs.setInputSettings("IroHarness Overlay", {
  url: "http://127.0.0.1:4178/?view=overlay",
  width: 1280,
  height: 720
});

await obs.setCurrentProgramScene("Main");
obs.close();
```

The OBS adapter controls stream presentation only. It does not own personality,
memory, PJOS, or permissions.
