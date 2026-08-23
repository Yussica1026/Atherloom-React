from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


NATIVE_VOICE_MOCK = r"""
(() => {
  const provider = {
    id: "voice-provider",
    name: "语音测试线路",
    protocol: "openai",
    base_url: "https://api.example.com/v1",
    model: "mock-model",
    models: ["mock-model"],
    enabled: true,
    has_api_key: true,
    stream_enabled: true,
  };
  let voiceProfile = {
    region: "cn",
    model: "speech-2.8-turbo",
    voice_id: "male-qn-qingse",
    speed: 1,
    volume: 1,
    pitch: 0,
    api_key: "",
  };
  window.__voiceEvents = [];
  window.__voiceStarts = 0;
  window.__voiceStops = 0;
  window.__recognitionActive = 0;
  window.__maxRecognitionActive = 0;
  window.__recognitionQueue = ["你好", "__hold__"];
  window.__miniMaxPayloads = [];
  window.__savedVoiceKey = "";
  window.__chatReply = "";

  const emitVoice = (callbackId, payload, delay = 0) => setTimeout(() => {
    window.AtherloomNativeVoice?.(callbackId, JSON.stringify(payload));
  }, delay);
  const publicProfile = () => {
    const copy = {...voiceProfile, has_api_key: Boolean(voiceProfile.api_key)};
    delete copy.api_key;
    return copy;
  };
  window.AtherloomNative = {
    getBackendUrl: () => "",
    setBackendUrl: () => JSON.stringify({ok: true}),
    listProviders: () => JSON.stringify([provider]),
    saveProvider: raw => raw,
    deleteProvider: () => JSON.stringify({ok: true}),
    getVoiceProfile: () => JSON.stringify({ok: true, profile: publicProfile()}),
    saveVoiceProfile: raw => {
      const next = JSON.parse(raw || "{}");
      if (next.api_key) voiceProfile.api_key = next.api_key;
      window.__savedVoiceKey = next.api_key || "";
      delete next.api_key;
      voiceProfile = {...voiceProfile, ...next};
      return JSON.stringify({ok: true, profile: publicProfile()});
    },
    startSpeechRecognition: (callbackId, language) => {
      window.__voiceStarts += 1;
      window.__recognitionActive += 1;
      window.__maxRecognitionActive = Math.max(window.__maxRecognitionActive, window.__recognitionActive);
      window.__voiceEvents.push(`recognition:start:${language}`);
      emitVoice(callbackId, {type: "ready"}, 5);
      const next = window.__recognitionQueue.shift() || "__hold__";
      if (next === "__hold__") return;
      setTimeout(() => { window.__recognitionActive = Math.max(0, window.__recognitionActive - 1); }, 8);
      if (next === "__permission__") emitVoice(callbackId, {type: "error", message: "Permission denied"}, 10);
      else emitVoice(callbackId, {type: "result", transcript: next}, 10);
    },
    stopSpeechRecognition: callbackId => {
      window.__voiceStops += 1;
      window.__recognitionActive = Math.max(0, window.__recognitionActive - 1);
      window.__voiceEvents.push(`recognition:stop:${callbackId}`);
    },
    synthesizeSpeechAsync: (raw, callbackId) => {
      const payload = JSON.parse(raw || "{}");
      window.__miniMaxPayloads.push(payload);
      window.__voiceEvents.push("minimax:start");
      emitVoice(callbackId, {type: "started"}, 5);
      emitVoice(callbackId, {type: "end"}, 15);
    },
    cancelSpeechSynthesis: callbackId => window.__voiceEvents.push(`minimax:stop:${callbackId}`),
    providerChatStream: (raw, callbackId) => {
      window.__voiceEvents.push("chat:start");
      const reply = window.__chatReply || "这是语音回复。";
      setTimeout(() => window.AtherloomNativeStream?.(callbackId, JSON.stringify({delta: reply})), 8);
      setTimeout(() => window.AtherloomNativeStream?.(callbackId, JSON.stringify({done: true, model: "mock-model"})), 16);
    },
    cancelStream: () => window.__voiceEvents.push("chat:cancel"),
    apiRequest: () => JSON.stringify({ok: false, status: 404, error: "not mocked"}),
  };

  class MockUtterance {
    constructor(text) { this.text = text; this.lang = ""; this.onend = null; this.onerror = null; }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {value: MockUtterance, configurable: true});
  Object.defineProperty(window, "speechSynthesis", {value: {
    speak(utterance) {
      window.__voiceEvents.push("system-tts:start");
      setTimeout(() => utterance.onend?.(), 12);
    },
    cancel() { window.__voiceEvents.push("system-tts:cancel"); },
  }, configurable: true});
})();
"""


def run() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        page.add_init_script(NATIVE_VOICE_MOCK)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto("http://127.0.0.1:5173", wait_until="networkidle")

        page.get_by_role("button", name="语音通话").click()
        dialog = page.get_by_role("dialog", name="语音通话")
        dialog.get_by_text("Android 原生识别", exact=False).wait_for()
        dialog.screenshot(path=str(ARTIFACTS / "react-mobile-voice-call.png"))
        dialog.get_by_role("button", name="开始通话").click()
        dialog.locator(".call-transcript-react .user").filter(has_text="你好").wait_for()
        dialog.locator(".call-transcript-react .assistant").filter(has_text="这是语音回复。").wait_for()
        page.wait_for_function("window.__voiceStarts === 2")
        assert page.evaluate("window.__maxRecognitionActive") == 1
        events = page.evaluate("window.__voiceEvents")
        assert events.index("chat:start") > events.index("recognition:start:zh-CN")
        assert events.index("system-tts:start") > events.index("chat:start")

        dialog.get_by_role("button", name="结束").click()
        starts_after_stop = page.evaluate("window.__voiceStarts")
        page.wait_for_timeout(100)
        assert page.evaluate("window.__voiceStarts") == starts_after_stop
        assert page.evaluate("window.__voiceStops") >= 1

        page.evaluate("window.__recognitionQueue = ['__permission__']")
        dialog.get_by_role("button", name="重新开始").click()
        dialog.get_by_text("麦克风权限未授予", exact=False).wait_for()
        permission_starts = page.evaluate("window.__voiceStarts")
        page.wait_for_timeout(100)
        assert page.evaluate("window.__voiceStarts") == permission_starts

        dialog.get_by_role("button", name="语音设置").click()
        settings = page.get_by_role("dialog", name="设置")
        settings.get_by_role("heading", name="语音通话").wait_for()
        settings.get_by_label("回复朗读").select_option("minimax")
        settings.screenshot(path=str(ARTIFACTS / "react-mobile-voice-settings.png"))
        settings.get_by_label("MiniMax API Key").fill("minimax-test-secret")
        settings.get_by_role("button", name="保存语音设置").click()
        settings.get_by_text("Key 只保存在 Android 加密存储", exact=False).wait_for()
        assert page.evaluate("window.__savedVoiceKey") == "minimax-test-secret"
        assert settings.get_by_label("MiniMax API Key").input_value() == ""
        persisted = page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1') || ''")
        assert "minimax-test-secret" not in persisted
        all_local_storage = page.evaluate("JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))")
        assert "minimax-test-secret" not in all_local_storage
        assert page.evaluate("JSON.parse(localStorage.getItem('atherloom-react:voice-config:v1')).output_provider") == "minimax"
        settings.get_by_role("button", name="关闭设置").click()

        long_reply = "这是一段用于验证旧款安卓分段播放不会一次吞下超长文本的回复。" * 20
        page.evaluate("value => { window.__chatReply = value; window.__recognitionQueue = ['再说一句', '__hold__']; }", long_reply)
        page.get_by_role("button", name="语音通话").click()
        dialog = page.get_by_role("dialog", name="语音通话")
        dialog.get_by_text("MiniMax TTS", exact=False).wait_for()
        dialog.get_by_role("button", name="开始通话").click()
        page.wait_for_function("window.__voiceStarts >= 5")
        payloads = page.evaluate("window.__miniMaxPayloads")
        assert len(payloads) > 1
        assert "".join(payload["text"] for payload in payloads) == long_reply
        assert all(len(payload["text"]) <= 240 for payload in payloads)
        assert all(payload["model"] == "speech-2.8-turbo" for payload in payloads)
        assert all(payload["voice_id"] == "male-qn-qingse" for payload in payloads)
        assert all("api_key" not in payload for payload in payloads)

        stops_before_back = page.evaluate("window.__voiceStops")
        page.evaluate("window.dispatchEvent(new Event('atherloom:back', {cancelable: true}))")
        dialog.wait_for(state="detached")
        assert page.evaluate("window.__voiceStops") > stops_before_back

        assert not console_errors, console_errors
        assert not page_errors, page_errors
        browser.close()
    print("PASS: voice state machine, permission failure, secure MiniMax settings, segmented native TTS, and Android back cleanup")


if __name__ == "__main__":
    run()
