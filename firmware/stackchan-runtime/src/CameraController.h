#pragma once

#include <Arduino.h>

namespace aiavatar {

class CameraController {
public:
    bool begin();
    bool isReady() const { return ready_; }
    bool captureJpeg(uint8_t** outBuf, size_t* outLen, uint8_t quality = 80);

private:
    bool ready_ = false;
};

}  // namespace aiavatar
