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

## Macro-Harness Stream Operations

IroHarness can route stream operation requests through the same permission
policy used for fans, members, moderators, and developers.

```js
import {
  createIroHarness,
  createRecorderStreamController
} from "iroharness";

const streamController = createRecorderStreamController();

const iroha = createIroHarness({
  character,
  projectOs,
  userRegistry,
  brains,
  streamController
});
```

Messages such as `OBSのシーンを変えて`, `overlay`, `scene`, `mute`, or `配信`
are routed as `stream` operations. The permission policy requires
`manage_stream`; public fans are denied without changing the character's
personality. Moderators and owners can execute stream operations, and scoped
overrides can grant temporary power for one stream session.

Production integrations should wrap `createObsWebSocketAdapter` behind a
stream controller that translates approved macro operations into OBS WebSocket
calls. The included `createRecorderStreamController` is a dependency-free
contract implementation for tests and local demos.
