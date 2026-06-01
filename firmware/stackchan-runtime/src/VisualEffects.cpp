#include "VisualEffects.h"

#include <Arduino.h>

namespace aiavatar {

VisualEffects::VisualEffects()
    : voiceDetectedUntilMs_(0),
      voiceVisible_(false) {}

void VisualEffects::showVoiceDetected(uint32_t durationMs) {
    voiceDetectedUntilMs_ = millis() + durationMs;
    voiceVisible_ = true;
}

bool VisualEffects::update() {
    bool visible = voiceDetected();
    if (voiceVisible_ == visible) return false;
    voiceVisible_ = visible;
    return true;
}

void VisualEffects::draw(LGFX_Sprite* canvas) const {
    if (!canvas || !voiceVisible_) return;
    drawListeningBorder(canvas);
}

bool VisualEffects::voiceDetected() const {
    return static_cast<int32_t>(millis() - voiceDetectedUntilMs_) < 0;
}

void VisualEffects::drawListeningBorder(LGFX_Sprite* canvas) const {
    const int w = canvas->width();
    const int h = canvas->height();
    const int glowWidth = 4;
    const int maxAlpha = 228;

    const int cA_r = 150, cA_g = 50, cA_b = 255;
    const int cB_r = 255, cB_g = 40, cB_b = 180;

    auto drawGlowPixel = [&](int x, int y, int dist) {
        int alpha = maxAlpha * (glowWidth - dist) / glowWidth;
        int t = ((w - 1 - x) * 128 / (w - 1)) + (y * 128 / (h - 1));

        int gr = cA_r + (cB_r - cA_r) * t / 256;
        int gg = cA_g + (cB_g - cA_g) * t / 256;
        int gb = cA_b + (cB_b - cA_b) * t / 256;

        uint32_t raw = canvas->readPixelValue(x, y);
        int bgR = ((raw >> 11) & 0x1F) << 3;
        int bgG = ((raw >> 5) & 0x3F) << 2;
        int bgB = (raw & 0x1F) << 3;

        int outR = bgR + (gr - bgR) * alpha / 255;
        int outG = bgG + (gg - bgG) * alpha / 255;
        int outB = bgB + (gb - bgB) * alpha / 255;

        canvas->drawPixel(x, y, canvas->color565(outR, outG, outB));
    };

    for (int dist = 0; dist < glowWidth; ++dist) {
        for (int x = dist; x < w - dist; ++x) {
            drawGlowPixel(x, dist, dist);
            drawGlowPixel(x, h - 1 - dist, dist);
        }
        for (int y = dist + 1; y < h - 1 - dist; ++y) {
            drawGlowPixel(dist, y, dist);
            drawGlowPixel(w - 1 - dist, y, dist);
        }
    }
}

}  // namespace aiavatar
