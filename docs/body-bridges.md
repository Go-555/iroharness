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

## Dev Server Endpoints

When body devices are passed to `createIroHarnessDevServer`, the server exposes:

```text
GET /bodies
GET /body/:id
GET /body/:id/events
```

`/body/:id` returns the latest snapshot. `/body/:id/events` streams body payloads
as Server-Sent Events.
