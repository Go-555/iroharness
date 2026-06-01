#include <Arduino.h>
#include <M5Unified.h>
#include <SD.h>
#include <SPIFFS.h>

#include "AIAvatarStackChan.h"

static aiavatar::Config config;
static aiavatar::AIAvatar avatar;

void setup() {
    Serial.begin(115200);
    const uint32_t serialStart = millis();
    while (!Serial && millis() - serialStart < 3000) {
        delay(10);
    }
    delay(300);
    Serial.println();
    Serial.println("[IroHarness StackChan] boot");

    auto m5cfg = M5.config();
    M5.begin(m5cfg);
    Serial.println("[IroHarness StackChan] M5 initialized");
    Serial.printf("[IroHarness StackChan] heap=%u psram=%u\n", ESP.getFreeHeap(), ESP.getFreePsram());

    bool configLoaded = false;
    if (SD.begin(GPIO_NUM_4, SPI, 25000000)) {
        Serial.println("[IroHarness StackChan] SD mounted");
        configLoaded = config.loadFromSD("/config.local.json") || config.loadFromSD("/config.json");
    } else {
        Serial.println("[IroHarness StackChan] SD not available");
    }

    if (!configLoaded) {
        if (SPIFFS.begin(true)) {
            Serial.println("[IroHarness StackChan] SPIFFS mounted");
            configLoaded =
                config.loadFromFS(SPIFFS, "/config.local.json") ||
                config.loadFromFS(SPIFFS, "/config.json");
        } else {
            Serial.println("[IroHarness StackChan] SPIFFS not available");
        }
    }

    if (config.wsHost[0] == '\0') {
        Serial.println("[IroHarness StackChan] WS host is empty; check /config.local.json or /config.json");
        while (true) delay(1000);
    }

    avatar.useStackChan();

    if (!avatar.begin(config)) {
        Serial.println("[IroHarness StackChan] runtime init failed");
        while (true) delay(1000);
    }
}

void loop() {
    avatar.update();
    delay(1);
}
