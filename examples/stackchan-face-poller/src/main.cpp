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
  String deviceId;
  uint32_t pollIntervalMs;
};

static AppConfig config;
static uint32_t lastPollMs = 0;
static String lastFace;
static String lastText;

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
  config.deviceId = doc["device_id"] | "stackchan";
  config.pollIntervalMs = doc["poll_interval_ms"] | 500;
  return config.wifiSsid.length() > 0 && config.faceUrl.length() > 0;
}

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPass.c_str());
  drawStatus("Wi-Fi", "Connecting...");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(250);
  }
  if (WiFi.status() == WL_CONNECTED) {
    drawStatus("Wi-Fi OK", WiFi.localIP().toString());
  } else {
    drawStatus("Wi-Fi failed", config.wifiSsid);
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

static void pollFace() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    return;
  }
  HTTPClient http;
  http.begin(config.faceUrl);
  int status = http.GET();
  if (status != 200) {
    drawStatus("HTTP error", String(status));
    http.end();
    return;
  }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    drawStatus("JSON error", error.c_str());
    return;
  }
  String face = doc["face"] | ":)";
  String mode = doc["mode"] | "idle";
  String text = doc["text"] | "";
  drawFace(face, mode, text);
}

static void sendTouchInvoke() {
  if (WiFi.status() != WL_CONNECTED || config.invokeUrl.length() == 0) {
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
}

void loop() {
  M5.update();
  if (M5.BtnA.wasClicked()) {
    sendTouchInvoke();
  }
  if (millis() - lastPollMs >= config.pollIntervalMs) {
    lastPollMs = millis();
    pollFace();
  }
  delay(10);
}
