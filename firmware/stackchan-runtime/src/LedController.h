#pragma once

#include "Config.h"
#include "HardwareAdapter.h"

#include <cstdint>

namespace aiavatar {

enum class LedAnimation : uint8_t {
    None,
    ToolPulse,
    AcceptedFlash,
    VisionFlash,
};

class LedController {
public:
    LedController();

    void begin(const Config& config);
    void setHardware(HardwareAdapter* hardware);
    void update();

    void setAcceptedColor(RgbColor color) { acceptedColor_ = color; }
    void setToolColor(RgbColor color) { toolColor_ = color; }
    void setColor(RgbColor color);
    void setPixel(uint8_t index, RgbColor color);
    void refresh();
    void off();
    uint8_t count() const;

    void startToolPulse();
    void startAcceptedFlash();
    void startVisionFlash();
    void stopAnimation();

    bool isEnabled() const { return hardware_ && hardware_->ledAvailable(); }

private:
    HardwareAdapter* hardware_;
    LedAnimation animation_;
    uint32_t animationStartMs_;
    uint32_t lastRenderMs_;
    RgbColor acceptedColor_;
    RgbColor toolColor_;

    static constexpr uint32_t kRenderIntervalMs = 33;
    static constexpr uint32_t kToolPulsePeriodMs = 1200;
    static constexpr uint32_t kToolPulseDurationMs = 3000;
    static constexpr uint32_t kAcceptedFlashMs = 1000;
    static constexpr uint32_t kVisionFlashMs = 420;

    void updateToolPulse();
    void updateAcceptedFlash();
    void updateVisionFlash();
    static RgbColor scaleColor(RgbColor color, float scale);
};

}  // namespace aiavatar
