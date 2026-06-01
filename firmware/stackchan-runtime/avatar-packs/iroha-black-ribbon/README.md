# Iroha Black Ribbon Avatar Pack

This pack is the IroHarness-owned StackChan avatar direction for Iroha.

## Base Face

- `avatar/neutral.png`: 320x240 StackChan-ready base face.
- `avatar/neutral_blink.png`: blink face.
- `avatar/joy.png`: happy face.
- `avatar/fun.png`: playful face.
- `avatar/angry.png`: annoyed face.
- `avatar/sorrow.png`: sad face.
- `avatar/mouth_half.png`: transparent mouth-only overlay for half-open lipsync.
- `avatar/mouth_open.png`: transparent mouth-only overlay for open-mouth lipsync.
- `source/neutral-source.png`: generated source image before 320x240 crop.

## Direction

- Black glossy long hair.
- Straight, slightly see-through bangs.
- One large black satin fabric bow, placed to the side/back of the head.
- Black lace/gothic collar.
- Amber-gold Iroha eyes.
- Sample-avatar-like deformation: large rounded head, large eyes, tiny low closed mouth, minimal nose, soft blush.
- Close-up StackChan framing: top hair/bow may crop slightly; chin remains fully visible.

## Runtime Notes

- Face images are full 320x240 PNG files.
- `mouth_half.png` and `mouth_open.png` are not full-face expressions. The firmware loads them as transparent overlays and composites them over the current face during lipsync.
- This pack intentionally does not include `surprised.png`; the current firmware falls back to neutral if that optional face is missing.

## Generation Note

The base face was generated with image generation from the user's selected option U.
It uses the user's attached black-ribbon reference photo only for mood, hairstyle, bow, and outfit direction. It is not intended to reproduce the real person's face or identity.

Prompt constraints used for the selected base:

```text
Soft black satin fabric bow, not cat ears.
Nearly front-facing but subtly angled.
Asymmetrical side hair volume.
Amber-gold Iroha eyes.
Tiny closed neutral mouth.
StackChan sample-style deformed 2D anime face.
320x240 close-up avatar sprite framing.
```
