#include "LedController.h"

#include <Arduino.h>
#include <cmath>

namespace aiavatar {

LedController::LedController()
    : hardware_(nullptr),
      animation_(LedAnimation::None),
      animationStartMs_(0),
      lastRenderMs_(0),
      acceptedColor_{0, 168, 0},
      toolColor_{140, 0, 140} {}

void LedController::begin(const Config& config) {
    acceptedColor_ = config.acceptedLedColor;
    toolColor_ = config.toolLedColor;
    off();
}

void LedController::setHardware(HardwareAdapter* hardware) {
    hardware_ = hardware;
    off();
}

void LedController::update() {
    if (animation_ != LedAnimation::None) {
        uint32_t now = millis();
        if (now - lastRenderMs_ < kRenderIntervalMs) return;
        lastRenderMs_ = now;
    }

    switch (animation_) {
        case LedAnimation::ToolPulse:
            updateToolPulse();
            break;
        case LedAnimation::AcceptedFlash:
            updateAcceptedFlash();
            break;
        case LedAnimation::VisionFlash:
            updateVisionFlash();
            break;
        case LedAnimation::None:
        default:
            break;
    }
}

void LedController::setColor(RgbColor color) {
    if (!isEnabled()) return;
    hardware_->setLedColor(color.r, color.g, color.b);
}

void LedController::setPixel(uint8_t index, RgbColor color) {
    if (!isEnabled()) return;
    hardware_->setLedPixel(index, color.r, color.g, color.b);
}

void LedController::refresh() {
    if (!isEnabled()) return;
    hardware_->refreshLed();
}

void LedController::off() {
    if (!isEnabled()) return;
    hardware_->setLedColor(0, 0, 0);
}

uint8_t LedController::count() const {
    if (!isEnabled()) return 0;
    return hardware_->ledCount();
}

void LedController::startToolPulse() {
    if (!isEnabled()) return;
    animation_ = LedAnimation::ToolPulse;
    animationStartMs_ = millis();
    lastRenderMs_ = 0;
}

void LedController::startAcceptedFlash() {
    if (!isEnabled()) return;
    animation_ = LedAnimation::AcceptedFlash;
    animationStartMs_ = millis();
    lastRenderMs_ = 0;
}

void LedController::startVisionFlash() {
    if (!isEnabled()) return;
    animation_ = LedAnimation::VisionFlash;
    animationStartMs_ = millis();
    lastRenderMs_ = 0;
}

void LedController::stopAnimation() {
    animation_ = LedAnimation::None;
    off();
}

void LedController::updateToolPulse() {
    uint32_t elapsed = millis() - animationStartMs_;
    if (elapsed >= kToolPulseDurationMs) {
        stopAnimation();
        return;
    }

    float phase = static_cast<float>(elapsed % kToolPulsePeriodMs) / kToolPulsePeriodMs;
    float brightness = (sinf(phase * 2.0f * static_cast<float>(M_PI) -
                             static_cast<float>(M_PI) / 2.0f) +
                        1.0f) /
                       2.0f;
    setColor(scaleColor(toolColor_, brightness));
}

void LedController::updateAcceptedFlash() {
    uint32_t elapsed = millis() - animationStartMs_;
    if (elapsed >= kAcceptedFlashMs) {
        stopAnimation();
        return;
    }

    float brightness = 1.0f - static_cast<float>(elapsed) / kAcceptedFlashMs;
    setColor(scaleColor(acceptedColor_, brightness));
}

void LedController::updateVisionFlash() {
    uint32_t elapsed = millis() - animationStartMs_;
    if (elapsed >= kVisionFlashMs) {
        stopAnimation();
        return;
    }

    uint32_t phase = elapsed % 210;
    bool on = phase < 80;
    setColor(on ? RgbColor{0, 80, 255} : RgbColor{0, 0, 0});
}

RgbColor LedController::scaleColor(RgbColor color, float scale) {
    if (scale < 0.0f) scale = 0.0f;
    if (scale > 1.0f) scale = 1.0f;
    return {
        static_cast<uint8_t>(color.r * scale),
        static_cast<uint8_t>(color.g * scale),
        static_cast<uint8_t>(color.b * scale),
    };
}

}  // namespace aiavatar
