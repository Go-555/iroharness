#include "StatusOverlay.h"

#include <Arduino.h>
#include <cmath>

namespace aiavatar {

StatusOverlay::StatusOverlay()
    : enabled_(true),
      hasState_(false),
      state_{} {}

bool StatusOverlay::update(const StatusOverlayState& state) {
    if (hasState_ && equals(state_, state)) return false;
    state_ = state;
    hasState_ = true;
    return enabled_;
}

void StatusOverlay::draw(LGFX_Sprite* canvas) const {
    if (!enabled_ || !hasState_ || !canvas) return;

    drawClock(canvas, state_.hour, state_.minute);
    drawMicIcon(canvas, state_.micMuted);
    drawWiFiIcon(canvas, state_.wifiConnected, state_.websocketConnected);
    drawBatteryIcon(canvas, state_.batteryLevel, state_.batteryCharging);
    if (state_.volumeVisible) {
        drawVolumeIndicator(canvas, state_.volumeLevel, state_.volumeLevelCount);
    }
}

bool StatusOverlay::equals(const StatusOverlayState& a, const StatusOverlayState& b) {
    return a.micMuted == b.micMuted &&
           a.volumeVisible == b.volumeVisible &&
           a.volumeLevel == b.volumeLevel &&
           a.volumeLevelCount == b.volumeLevelCount &&
           a.wifiConnected == b.wifiConnected &&
           a.websocketConnected == b.websocketConnected &&
           a.batteryLevel == b.batteryLevel &&
           a.batteryCharging == b.batteryCharging &&
           a.hour == b.hour &&
           a.minute == b.minute;
}

void StatusOverlay::drawClock(LGFX_Sprite* canvas, uint8_t hour, uint8_t minute) {
    char buf[6];
    snprintf(buf, sizeof(buf), "%02u:%02u", hour, minute);

    const int x = 18;
    const int y = 6;
    canvas->setFont(nullptr);
    canvas->setTextSize(3);
    canvas->setTextDatum(top_left);
    canvas->setTextColor(TFT_BLACK);
    for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
            if (dx == 0 && dy == 0) continue;
            canvas->drawString(buf, x + dx, y + dy);
        }
    }
    canvas->setTextColor(TFT_WHITE);
    canvas->drawString(buf, x, y);
}

void StatusOverlay::drawMicIcon(LGFX_Sprite* canvas, bool muted) {
    const int x = 228;
    const int y = 4;
    const int cx = x + 14;
    const int cy = y + 12;

    canvas->fillRoundRect(x, y, 28, 28, 6, 0x2104);
    uint16_t color = muted ? TFT_WHITE : TFT_GREEN;
    canvas->fillRoundRect(cx - 3, cy - 7, 7, 11, 3, color);
    canvas->drawRoundRect(cx - 6, cy - 2, 13, 9, 4, color);
    canvas->drawFastVLine(cx, cy + 7, 3, color);
    canvas->drawFastHLine(cx - 3, cy + 10, 7, color);
    if (muted) {
        canvas->drawLine(x + 4, y + 24, x + 24, y + 4, TFT_WHITE);
        canvas->drawLine(x + 5, y + 24, x + 25, y + 4, TFT_WHITE);
    }
}

void StatusOverlay::drawWiFiIcon(LGFX_Sprite* canvas, bool wifiConnected, bool wsConnected) {
    const int x = 258;
    const int y = 4;
    const int cx = x + 14;
    const int by = y + 19;

    canvas->fillRoundRect(x, y, 28, 28, 6, 0x2104);
    uint16_t color;
    if (!wifiConnected) color = TFT_RED;
    else if (wsConnected) color = TFT_GREEN;
    else color = TFT_WHITE;

    for (int a = -50; a <= 50; ++a) {
        float rad = a * 3.14159f / 180.0f;
        canvas->drawPixel(cx + static_cast<int>(11 * sinf(rad)),
                          by - static_cast<int>(11 * cosf(rad)), color);
    }
    for (int a = -50; a <= 50; ++a) {
        float rad = a * 3.14159f / 180.0f;
        canvas->drawPixel(cx + static_cast<int>(7 * sinf(rad)),
                          by - static_cast<int>(7 * cosf(rad)), color);
    }
    for (int a = -50; a <= 50; ++a) {
        float rad = a * 3.14159f / 180.0f;
        canvas->drawPixel(cx + static_cast<int>(3 * sinf(rad)),
                          by - static_cast<int>(3 * cosf(rad)), color);
    }
    canvas->fillCircle(cx, by, 1, color);
    if (!wifiConnected) {
        canvas->drawLine(x + 4, y + 24, x + 24, y + 4, TFT_RED);
        canvas->drawLine(x + 5, y + 24, x + 25, y + 4, TFT_RED);
    }
}

void StatusOverlay::drawBatteryIcon(LGFX_Sprite* canvas, int8_t level, bool charging) {
    const int x = 288;
    const int y = 4;
    canvas->fillRoundRect(x, y, 28, 28, 6, 0x2104);

    const uint16_t outline = 0xC618;
    canvas->drawRoundRect(x + 3, y + 8, 18, 12, 2, outline);
    canvas->fillRect(x + 21, y + 11, 3, 6, outline);

    if (level < 0) {
        canvas->setTextColor(outline);
        canvas->setTextSize(1);
        canvas->drawChar('?', x + 9, y + 10);
        return;
    }

    uint16_t fillColor;
    if (level >= 50) fillColor = TFT_GREEN;
    else if (level >= 20) fillColor = TFT_YELLOW;
    else fillColor = TFT_RED;

    int fillW = static_cast<int>(level) * 14 / 100;
    if (fillW < 1 && level > 0) fillW = 1;
    if (fillW > 0) canvas->fillRect(x + 5, y + 10, fillW, 8, fillColor);

    if (charging) {
        const uint16_t boltColor = TFT_WHITE;
        int cx = x + 12;
        int cy = y + 14;
        canvas->fillTriangle(cx + 3, cy - 6, cx - 3, cy, cx + 1, cy, boltColor);
        canvas->fillTriangle(cx - 1, cy, cx + 3, cy, cx - 3, cy + 6, boltColor);
    }
}

void StatusOverlay::drawVolumeIndicator(LGFX_Sprite* canvas, uint8_t level,
                                        uint8_t levelCount) {
    if (!canvas || levelCount <= 1) return;

    const uint8_t n = levelCount - 1;
    const int barH = 28;
    const int gap = 5;
    const int maxW = 30;
    const int x = 5;
    const int totalH = n * barH + (n - 1) * gap;
    const int startY = (canvas->height() - totalH) / 2;

    canvas->fillRoundRect(x - 3, startY - 6, maxW + 6, totalH + 12, 6, 0x2104);
    for (uint8_t i = 1; i <= n; ++i) {
        int fromTop = n - i;
        int y = startY + fromTop * (barH + gap);
        int w = maxW * i / n;
        bool filled = level >= i;
        canvas->fillRoundRect(x, y, w, barH, 3, filled ? TFT_GREEN : 0x4208);
    }
}

}  // namespace aiavatar
