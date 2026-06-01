#pragma once

#include <cstdint>

namespace aiavatar {

class HardwareAdapter {
public:
    virtual ~HardwareAdapter() = default;

    virtual bool begin() = 0;
    virtual void update() = 0;
    virtual const char* name() const = 0;

    virtual bool motionAvailable() const { return false; }
    virtual void moveMotion(int16_t yaw, int16_t pitch, uint16_t speed) {
        (void)yaw;
        (void)pitch;
        (void)speed;
    }
    virtual bool consumeNadeEvent() { return false; }

    virtual bool ledAvailable() const { return false; }
    virtual uint8_t ledCount() const { return 0; }
    virtual void setLedColor(uint8_t r, uint8_t g, uint8_t b) {
        (void)r;
        (void)g;
        (void)b;
    }
    virtual void setLedPixel(uint8_t index, uint8_t r, uint8_t g, uint8_t b) {
        (void)index;
        (void)r;
        (void)g;
        (void)b;
    }
    virtual void refreshLed() {}
};

}  // namespace aiavatar
