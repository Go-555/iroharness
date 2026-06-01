#pragma once

#include <M5Unified.h>
#include <cstdint>

namespace aiavatar {

class VisualEffects {
public:
    VisualEffects();

    void showVoiceDetected(uint32_t durationMs);
    bool update();
    void draw(LGFX_Sprite* canvas) const;
    bool voiceDetected() const;

private:
    uint32_t voiceDetectedUntilMs_;
    bool voiceVisible_;

    void drawListeningBorder(LGFX_Sprite* canvas) const;
};

}  // namespace aiavatar
