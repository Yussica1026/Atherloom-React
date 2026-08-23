from pathlib import Path
import unittest
import xml.etree.ElementTree as ElementTree


ANDROID = Path(__file__).resolve().parents[1]
MANIFEST = ANDROID / "app" / "src" / "main" / "AndroidManifest.xml"
JAVA = ANDROID / "app" / "src" / "main" / "java" / "app" / "atherloom" / "react"


class AndroidVoiceContractTests(unittest.TestCase):
    def test_manifest_declares_optional_microphone(self) -> None:
        manifest = ElementTree.parse(MANIFEST).getroot()
        android = "{http://schemas.android.com/apk/res/android}"
        permissions = {item.attrib[f"{android}name"] for item in manifest.findall("uses-permission")}
        self.assertIn("android.permission.RECORD_AUDIO", permissions)
        microphones = [
            item for item in manifest.findall("uses-feature")
            if item.attrib.get(f"{android}name") == "android.hardware.microphone"
        ]
        self.assertEqual("false", microphones[0].attrib.get(f"{android}required"))
        recognition_queries = manifest.findall("./queries/intent/action")
        self.assertIn(
            "android.speech.RecognitionService",
            {item.attrib.get(f"{android}name") for item in recognition_queries},
        )

    def test_webview_grants_only_audio_to_the_local_asset_origin(self) -> None:
        source = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
        index = (ANDROID.parent / "index.html").read_text(encoding="utf-8")
        self.assertIn('ASSET_HOST = "appassets.androidplatform.net"', source)
        self.assertIn("origin.getPort() == -1 || origin.getPort() == 443", source)
        self.assertIn("onPermissionRequest(PermissionRequest request)", source)
        self.assertIn("new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}", source)
        self.assertNotIn("request.grant(request.getResources())", source)
        self.assertIn("isTrustedAssetNavigation(uri)", source)
        self.assertIn("request.isForMainFrame()", source)
        self.assertIn("Intent.CATEGORY_BROWSABLE", source)
        self.assertIn("frame-src 'none'", index)

    def test_native_bridge_and_terminal_cleanup_are_present(self) -> None:
        activity = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
        controller = (JAVA / "NativeSpeechController.java").read_text(encoding="utf-8")
        self.assertIn("startSpeechRecognition(String callbackId, String languageTag)", activity)
        self.assertIn("stopSpeechRecognition(String callbackId)", activity)
        self.assertIn("window.AtherloomNativeVoice", controller)
        for event_type in ("ready", "result", "error", "end"):
            self.assertIn(f'\"{event_type}\"', controller)
        self.assertIn("SESSION_TIMEOUT_MS", controller)
        self.assertIn("current.destroy()", controller)
        self.assertIn("replayPausedTerminalEvent()", controller)
        self.assertIn("speechController.onPause(recordAudioPermissionInFlight)", activity)
        self.assertIn("speechController.destroy()", activity)

    def test_minimax_tts_bridge_keeps_keys_native_and_hosts_fixed(self) -> None:
        activity = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
        controller = (JAVA / "MiniMaxSpeechController.java").read_text(encoding="utf-8")
        for signature in (
            "getVoiceProfile()",
            "saveVoiceProfile(String raw)",
            "synthesizeSpeechAsync(String raw, String callbackId)",
            "cancelSpeechSynthesis(String callbackId)",
        ):
            self.assertIn(signature, activity)
        self.assertIn("EncryptedSharedPreferences.create", controller)
        self.assertIn("runOnMain(() -> startSynthesis", controller)
        self.assertIn("if (paused)", controller)
        self.assertIn('https://api.minimaxi.com/v1/t2a_v2', controller)
        self.assertIn('https://api.minimax.io/v1/t2a_v2', controller)
        self.assertNotIn('optString("base_url"', controller)
        self.assertIn('setRequestProperty("Authorization", "Bearer " + request.apiKey)', controller)
        self.assertIn('put("output_format", "hex")', controller)
        self.assertIn('return "Chinese,Yue"', controller)
        self.assertNotIn('return "Cantonese"', controller)
        self.assertIn('response.optJSONObject("base_resp")', controller)
        self.assertIn('response.optJSONObject("data")', controller)
        self.assertIn('response.optString("trace_id", "")', controller)
        self.assertIn("new MediaPlayer()", controller)
        for event_type in ("started", "end", "error"):
            self.assertIn(f'\"{event_type}\"', controller)
        self.assertIn("setInstanceFollowRedirects(false)", controller)
        self.assertIn("MAX_TEXT_CHARACTERS = 2_000", controller)
        self.assertIn("MAX_RESPONSE_BYTES = 8 * 1024 * 1024", controller)
        self.assertIn("getContentLengthLong()", controller)
        self.assertIn("player.release()", controller)
        self.assertIn("cancelSpeechSynthesis", activity)
        self.assertIn("miniMaxSpeechController.onPause()", activity)
        self.assertIn("miniMaxSpeechController.destroy()", activity)


if __name__ == "__main__":
    unittest.main()
