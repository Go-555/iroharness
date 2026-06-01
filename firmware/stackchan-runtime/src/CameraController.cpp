#include "CameraController.h"

#include <M5Unified.h>

#if __has_include(<esp_camera.h>) && __has_include(<img_converters.h>)
#include <esp_camera.h>
#include <img_converters.h>
#define AIAVATAR_HAS_ESP_CAMERA 1
#else
#define AIAVATAR_HAS_ESP_CAMERA 0
#endif

namespace aiavatar {

#if AIAVATAR_HAS_ESP_CAMERA
static camera_config_t cameraConfig = {
    .pin_pwdn = -1,
    .pin_reset = -1,
    .pin_xclk = -1,
    .pin_sscb_sda = 12,
    .pin_sscb_scl = 11,
    .pin_d7 = 47,
    .pin_d6 = 48,
    .pin_d5 = 16,
    .pin_d4 = 15,
    .pin_d3 = 42,
    .pin_d2 = 41,
    .pin_d1 = 40,
    .pin_d0 = 39,
    .pin_vsync = 46,
    .pin_href = 38,
    .pin_pclk = 45,
    .xclk_freq_hz = 20000000,
    .ledc_timer = LEDC_TIMER_0,
    .ledc_channel = LEDC_CHANNEL_0,
    .pixel_format = PIXFORMAT_RGB565,
    .frame_size = FRAMESIZE_QVGA,
    .jpeg_quality = 0,
    .fb_count = 1,
    .fb_location = CAMERA_FB_IN_PSRAM,
    .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
    .sccb_i2c_port = -1,
};
#endif

bool CameraController::begin() {
#if AIAVATAR_HAS_ESP_CAMERA
    M5.In_I2C.release();
    esp_err_t err = esp_camera_init(&cameraConfig);
    if (err != ESP_OK) {
        Serial.printf("[Camera] init failed: 0x%x\n", err);
        return false;
    }

    sensor_t* sensor = esp_camera_sensor_get();
    if (sensor) {
        sensor->set_framesize(sensor, FRAMESIZE_QVGA);
    }

    ready_ = true;
    Serial.println("[Camera] init ok");
    return true;
#else
    Serial.println("[Camera] esp_camera unavailable");
    return false;
#endif
}

bool CameraController::captureJpeg(uint8_t** outBuf, size_t* outLen, uint8_t quality) {
    if (!ready_ || !outBuf || !outLen) return false;

#if AIAVATAR_HAS_ESP_CAMERA
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);

    fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("[Camera] capture failed");
        return false;
    }

    uint8_t* jpgBuf = nullptr;
    size_t jpgLen = 0;
    bool converted = frame2jpg(fb, quality, &jpgBuf, &jpgLen);
    esp_camera_fb_return(fb);

    if (!converted || !jpgBuf) {
        Serial.println("[Camera] JPEG conversion failed");
        return false;
    }

    *outBuf = jpgBuf;
    *outLen = jpgLen;
    return true;
#else
    return false;
#endif
}

}  // namespace aiavatar
