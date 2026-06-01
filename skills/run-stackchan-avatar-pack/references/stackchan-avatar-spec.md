# StackChan Avatar Spec

The runtime expects these files under an `avatar/` directory:

| File | Type | Notes |
|---|---|---|
| `neutral.png` | full face | Default face. |
| `neutral_blink.png` | full face | Used only while neutral blinking. |
| `joy.png` | full face | Happy expression. |
| `fun.png` | full face | Playful expression. |
| `angry.png` | full face | Annoyed expression. |
| `sorrow.png` | full face | Sad expression. |
| `mouth_half.png` | transparent overlay | Mouth-only half-open lipsync overlay. |
| `mouth_open.png` | transparent overlay | Mouth-only open-mouth lipsync overlay. |

All files must be PNG images sized `320x240`.

`mouth_half.png` and `mouth_open.png` are not full-face expressions. The
firmware composites them over the current face during speech. Keep the image
transparent except for the small area needed to hide the closed mouth and draw
the open mouth.

`surprised.png` is optional in the current runtime. Do not require it for the
standard pack unless the firmware contract changes.
