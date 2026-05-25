# Body Bridges

IroHarness treats visual bodies and devices as renderers of the same character
state. The macro harness owns identity; each body owns only presentation.

## Mapped Body Device

`createMappedBodyBridgeDevice` turns character events into renderer-specific
payloads and keeps the latest snapshot.

```js
const body = createMappedBodyBridgeDevice({
  id: "custom-body",
  kind: "custom",
  mapper,
  mapPayload({ state, mapped, speechText }) {
    return { mapped, text: speechText, mode: state.mode };
  }
});
```

Each body bridge supports:

- `emit(event)`: receive IroHarness `state`, `speech`, or `task` events
- `snapshot()`: return the latest body payload
- `payloads()`: return recent payload history
- `connect(req, res)`: stream payloads as Server-Sent Events

## MotionPNGTuber

```js
import { createMotionPngTuberRendererBridge } from "iroharness/adapters";

const mpt = createMotionPngTuberRendererBridge({
  assets: {
    mouth_on_eye_on: "/assets/talking.png",
    mouth_off_eye_on: "/assets/idle.png",
    mouth_off_eye_off: "/assets/error.png"
  }
});
```

The payload shape is:

```json
{
  "stateKey": "mouth_on_eye_on",
  "asset": "/assets/talking.png",
  "mode": "speaking",
  "emotion": "attentive",
  "speechText": "こんにちは"
}
```

An OBS browser source, MotionPNGTuber overlay, or AIAvatarKit route can subscribe
to this payload and swap PNGs without owning the character.

## M5Stack

```js
import { createM5StackBodyBridge } from "iroharness/adapters";

const m5 = createM5StackBodyBridge();
```

The payload shape is:

```json
{
  "face": ">_>",
  "mode": "working",
  "text": "作業中だよ"
}
```

The bridge is intentionally tiny so a Raspberry Pi or M5Stack relay can poll
JSON or subscribe to SSE and draw the face locally.

## Even G2

```js
import { createEvenG2DisplayBridge } from "iroharness/adapters";

const even = createEvenG2DisplayBridge();
```

The payload shape is:

```json
{
  "text": "見てみるね。",
  "mode": "speaking"
}
```

## Live2D

```js
import { createLive2DBodyBridge } from "iroharness/adapters";

const live2d = createLive2DBodyBridge();
```

The payload shape is:

```json
{
  "expression": "serious",
  "motion": "Talk",
  "lipSync": {
    "active": true,
    "text": "説明するね"
  },
  "parameters": {
    "mouthOpenY": 1,
    "eyeOpenLeft": 1,
    "eyeOpenRight": 1
  },
  "mode": "speaking",
  "emotion": "focused"
}
```

Live2D runtimes can map these names to model-specific expression and motion
files. IroHarness does not need to know the model file layout.

## VRM / 3D

```js
import { createVrmBodyBridge } from "iroharness/adapters";

const vrm = createVrmBodyBridge();
```

The payload shape is:

```json
{
  "expression": "happy",
  "animation": "think",
  "gaze": "left",
  "speaking": false,
  "caption": "",
  "mode": "thinking",
  "emotion": "attentive"
}
```

Three.js, VRM, Unity, or WebXR renderers can subscribe to this payload and map it
to their local animation clips and blendshape names.

## Dev Server Endpoints

When body devices are passed to `createIroHarnessDevServer`, the server exposes:

```text
GET /bodies
GET /body/:id
GET /body/:id/events
```

`/body/:id` returns the latest snapshot. `/body/:id/events` streams body payloads
as Server-Sent Events.
