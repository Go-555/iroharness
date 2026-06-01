#include "ScreenRenderer.h"

#include <Arduino.h>
#include <SD.h>
#include <cstdlib>

namespace aiavatar {

ScreenRenderer::ScreenRenderer()
    : canvas_(nullptr),
      currentBase_(nullptr),
      currentOverlay_(nullptr),
      overlayCb_(nullptr),
      dirty_(true),
      width_(320),
      height_(240) {}

bool ScreenRenderer::begin(uint8_t rotation, uint8_t brightness) {
    M5.Display.setRotation(rotation);
    M5.Display.setBrightness(brightness);
    width_ = M5.Display.width();
    height_ = M5.Display.height();
    M5.Display.fillScreen(TFT_BLACK);

    canvas_ = new LGFX_Sprite(&M5.Display);
    if (!canvas_) return false;
    canvas_->setColorDepth(16);
    canvas_->setPsram(true);
    if (!canvas_->createSprite(width_, height_)) {
        Serial.println("[Display] canvas allocation failed");
        delete canvas_;
        canvas_ = nullptr;
        return false;
    }

    dirty_ = true;
    Serial.printf("[Display] initialized %dx%d\n", width_, height_);
    return true;
}

LGFX_Sprite* ScreenRenderer::loadSprite(const char* path, int w, int h, uint16_t bgColor) {
    if (!path || !path[0]) return nullptr;

    File file = SD.open(path, FILE_READ);
    if (!file) {
        Serial.printf("[Display] open failed: %s\n", path);
        return nullptr;
    }

    size_t len = file.size();
    uint8_t* png = static_cast<uint8_t*>(ps_malloc(len));
    if (!png) png = static_cast<uint8_t*>(malloc(len));
    if (!png) {
        Serial.printf("[Display] image buffer allocation failed: %s (%u bytes)\n", path, len);
        file.close();
        return nullptr;
    }

    size_t readLen = file.read(png, len);
    file.close();
    if (readLen != len) {
        Serial.printf("[Display] read failed: %s\n", path);
        free(png);
        return nullptr;
    }

    auto* sprite = new LGFX_Sprite(&M5.Display);
    if (!sprite) {
        free(png);
        return nullptr;
    }
    sprite->setColorDepth(16);
    sprite->setPsram(true);
    if (!sprite->createSprite(w, h)) {
        Serial.printf("[Display] sprite allocation failed: %s\n", path);
        delete sprite;
        free(png);
        return nullptr;
    }

    int imgW = w;
    int imgH = h;
    if (len >= 24) {
        imgW = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
        imgH = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    }
    int offsetX = (w - imgW) / 2;
    int offsetY = (h - imgH) / 2;
    if (offsetX < 0) offsetX = 0;
    if (offsetY < 0) offsetY = 0;

    sprite->fillSprite(bgColor);
    sprite->drawPng(png, len, offsetX, offsetY);
    free(png);

    Serial.printf("[Display] loaded %s\n", path);
    return sprite;
}

void ScreenRenderer::setBase(LGFX_Sprite* sprite) {
    if (currentBase_ == sprite) return;
    currentBase_ = sprite;
    dirty_ = true;
}

void ScreenRenderer::setOverlay(LGFX_Sprite* sprite) {
    if (currentOverlay_ == sprite) return;
    currentOverlay_ = sprite;
    dirty_ = true;
}

void ScreenRenderer::update() {
    if (!dirty_ || !canvas_) return;
    dirty_ = false;

    if (currentBase_) {
        currentBase_->pushSprite(canvas_, 0, 0);
    } else {
        canvas_->fillSprite(TFT_BLACK);
    }
    if (currentOverlay_) {
        currentOverlay_->pushSprite(canvas_, 0, 0, kTransparentColor);
    }
    if (overlayCb_) overlayCb_(canvas_);

    canvas_->pushSprite(0, 0);
}

}  // namespace aiavatar
