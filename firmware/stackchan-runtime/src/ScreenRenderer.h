#pragma once

#include <M5Unified.h>

namespace aiavatar {

using ScreenOverlayCallback = void (*)(LGFX_Sprite* canvas);

class ScreenRenderer {
public:
    ScreenRenderer();

    bool begin(uint8_t rotation = 1, uint8_t brightness = 128);
    LGFX_Sprite* loadSprite(const char* path, int w, int h,
                            uint16_t bgColor = TFT_BLACK);

    void setBase(LGFX_Sprite* sprite);
    void setOverlay(LGFX_Sprite* sprite);
    void onOverlay(ScreenOverlayCallback cb) { overlayCb_ = cb; setDirty(); }
    void update();
    void setDirty() { dirty_ = true; }

    int width() const { return width_; }
    int height() const { return height_; }
    bool ready() const { return canvas_ != nullptr; }

    static constexpr uint16_t kTransparentColor = 0xF81F;

private:
    LGFX_Sprite* canvas_;
    LGFX_Sprite* currentBase_;
    LGFX_Sprite* currentOverlay_;
    ScreenOverlayCallback overlayCb_;
    bool dirty_;
    int width_;
    int height_;
};

}  // namespace aiavatar
