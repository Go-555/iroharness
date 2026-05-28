#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <M5Unified.h>
#include <SPIFFS.h>
#include <WiFi.h>

struct AppConfig {
  String wifiSsid;
  String wifiPass;
  String faceUrl;
  String invokeUrl;
  String deviceToken;
  String deviceId;
  uint32_t pollIntervalMs;
  uint32_t wifiRetryBaseMs;
  uint32_t wifiRetryMaxMs;
  uint32_t httpRetryBaseMs;
  uint32_t httpRetryMaxMs;
};

static AppConfig config;
static uint32_t nextPollMs = 0;
static uint32_t nextWifiAttemptMs = 0;
static uint32_t wifiRetryMs = 0;
static uint32_t httpRetryMs = 0;
static String lastFace;
static String lastText;

static uint32_t clampDelay(uint32_t value, uint32_t minimum, uint32_t maximum) {
  if (value < minimum) {
    return minimum;
  }
  if (value > maximum) {
    return maximum;
  }
  return value;
}

static uint32_t nextBackoff(uint32_t current, uint32_t base, uint32_t maximum) {
  if (current == 0) {
    return clampDelay(base, 250, maximum);
  }
  return clampDelay(current * 2, base, maximum);
}

static void drawStatus(const String& line1, const String& line2 = "") {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(8, 16);
  M5.Display.println(line1);
  if (line2.length() > 0) {
    M5.Display.setTextSize(1);
    M5.Display.setCursor(8, 52);
    M5.Display.println(line2);
  }
}

static bool loadConfig() {
  if (!SPIFFS.begin(true)) {
    return false;
  }
  File file = SPIFFS.open("/config.json", "r");
  if (!file) {
    return false;
  }
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, file);
  if (error) {
    return false;
  }
  config.wifiSsid = doc["wifi_ssid"] | "";
  config.wifiPass = doc["wifi_pass"] | "";
  config.faceUrl = doc["face_url"] | "http://127.0.0.1:4182/stackchan/face";
  config.invokeUrl = doc["invoke_url"] | "http://127.0.0.1:4182/device/stackchan/invoke";
  config.deviceToken = doc["device_token"] | "";
  config.deviceId = doc["device_id"] | "stackchan";
  config.pollIntervalMs = doc["poll_interval_ms"] | 500;
  config.wifiRetryBaseMs = doc["wifi_retry_base_ms"] | 1000;
  config.wifiRetryMaxMs = doc["wifi_retry_max_ms"] | 30000;
  config.httpRetryBaseMs = doc["http_retry_base_ms"] | 1000;
  config.httpRetryMaxMs = doc["http_retry_max_ms"] | 15000;
  config.pollIntervalMs = clampDelay(config.pollIntervalMs, 250, 60000);
  config.wifiRetryBaseMs = clampDelay(config.wifiRetryBaseMs, 250, config.wifiRetryMaxMs);
  config.httpRetryBaseMs = clampDelay(config.httpRetryBaseMs, 250, config.httpRetryMaxMs);
  return config.wifiSsid.length() > 0 && config.faceUrl.length() > 0;
}

static bool connectWifi() {
  uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    wifiRetryMs = 0;
    nextWifiAttemptMs = 0;
    return true;
  }
  if (nextWifiAttemptMs > 0 && now < nextWifiAttemptMs) {
    return false;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPass.c_str());
  drawStatus("Wi-Fi", "Connecting...");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
    delay(250);
    M5.update();
  }
  if (WiFi.status() == WL_CONNECTED) {
    wifiRetryMs = 0;
    nextWifiAttemptMs = 0;
    drawStatus("Wi-Fi OK", WiFi.localIP().toString());
    return true;
  } else {
    wifiRetryMs = nextBackoff(wifiRetryMs, config.wifiRetryBaseMs, config.wifiRetryMaxMs);
    nextWifiAttemptMs = millis() + wifiRetryMs;
    drawStatus("Wi-Fi failed", "Retry in " + String(wifiRetryMs / 1000) + "s");
    return false;
  }
}

static void drawFace(const String& face, const String& mode, const String& text) {
  if (face == lastFace && text == lastText) {
    return;
  }
  lastFace = face;
  lastText = text;
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_GREEN, TFT_BLACK);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextSize(6);
  M5.Display.drawString(face, M5.Display.width() / 2, M5.Display.height() / 2 - 20);
  M5.Display.setTextDatum(top_left);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.drawString(mode, 8, 8);
  M5.Display.drawString(text.substring(0, 48), 8, M5.Display.height() - 28);
}

static void resetHttpBackoff() {
  httpRetryMs = 0;
}

static void scheduleHttpBackoff(const String& reason) {
  httpRetryMs = nextBackoff(httpRetryMs, config.httpRetryBaseMs, config.httpRetryMaxMs);
  nextPollMs = millis() + httpRetryMs;
  drawStatus(reason, "Retry in " + String(httpRetryMs / 1000) + "s");
}

static void pollFace() {
  if (!connectWifi()) {
    return;
  }
  HTTPClient http;
  http.begin(config.faceUrl);
  int status = http.GET();
  if (status != 200) {
    http.end();
    scheduleHttpBackoff("HTTP " + String(status));
    return;
  }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    scheduleHttpBackoff("JSON error");
    return;
  }
  resetHttpBackoff();
  nextPollMs = millis() + config.pollIntervalMs;
  String face = doc["face"] | ":)";
  String mode = doc["mode"] | "idle";
  String text = doc["text"] | "";
  drawFace(face, mode, text);
}

static void sendTouchInvoke() {
  if (!connectWifi() || config.invokeUrl.length() == 0) {
    return;
  }
  JsonDocument doc;
  doc["type"] = "touch";
  doc["deviceId"] = config.deviceId;
  doc["userId"] = config.deviceId;
  doc["channel"] = "local";
  doc["text"] = "$StackChanのボタンが押されました。短く反応してください。";
  String payload;
  serializeJson(doc, payload);

  HTTPClient http;
  http.begin(config.invokeUrl);
  http.addHeader("content-type", "application/json");
  if (config.deviceToken.length() > 0) {
    http.addHeader("x-iroharness-device-token", config.deviceToken);
  }
  int status = http.POST(payload);
  http.end();
  drawStatus("Invoke", String(status));
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  drawStatus("IroHarness", "StackChan face poller");
  if (!loadConfig()) {
    drawStatus("Config error", "/config.json");
    return;
  }
  connectWifi();
  nextPollMs = millis();
}

void loop() {
  M5.update();
  if (M5.BtnA.wasClicked()) {
    sendTouchInvoke();
  }
  if (millis() >= nextPollMs) {
    nextPollMs = millis() + config.pollIntervalMs;
    pollFace();
  }
  delay(10);
}
