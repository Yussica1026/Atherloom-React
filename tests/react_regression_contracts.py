from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class LegacyRegressionContracts(unittest.TestCase):
    def test_failed_assistant_is_not_a_saved_timeline_version(self):
        store = source("src/adapters/standalone/store.ts")
        self.assertIn("!message.error && !message.pending", store)
        self.assertLess(store.index("const eligible = messages.filter"), store.index("const selectedByParent"))

    def test_summary_is_invalidated_on_timeline_mutations(self):
        store = source("src/adapters/standalone/store.ts")
        self.assertGreaterEqual(store.count('conversation.summary = ""'), 4)
        self.assertGreaterEqual(store.count("conversation.archived_message_ids = []"), 4)

    def test_pending_state_renders_before_automatic_compression(self):
        workspace = source("src/features/workspace/useWorkspace.ts")
        pending = workspace.index("setBusy(true)")
        paint = workspace.index("requestAnimationFrame(() => requestAnimationFrame")
        compress = workspace.index("fastApi.compressConversation(currentId")
        self.assertLess(pending, paint)
        self.assertLess(paint, compress)

    def test_rapid_setting_saves_are_serialized(self):
        workspace = source("src/features/workspace/useWorkspace.ts")
        self.assertIn("settingsRevisionRef", workspace)
        self.assertIn("settingsSaveRef.current.catch(() => undefined).then", workspace)

    def test_message_template_does_not_rewrite_saved_user_text(self):
        store = source("src/adapters/standalone/store.ts")
        saved_message = store.index("const userMessage: Message")
        templated = store.index("const templatedContent")
        self.assertLess(saved_message, templated)
        self.assertIn("content: request.content", store[saved_message:templated])

    def test_persona_navigation_has_stale_response_guard(self):
        workspace = source("src/features/workspace/useWorkspace.ts")
        block = workspace[workspace.index("const openConversation"):workspace.index("const createConversation")]
        self.assertIn("++personaRequestRef.current", block)
        self.assertIn("requestId !== personaRequestRef.current", block)

    def test_pdf_is_real_local_extraction(self):
        hub = source("src/features/spaces/FeatureHub.tsx")
        self.assertIn("pdf.worker.mjs", hub)
        self.assertIn("getTextContent", hub)
        self.assertIn("await task.destroy()", hub)
        self.assertNotIn("请先转成 TXT", hub)

    def test_android_exports_are_not_browser_only_and_backup_is_redacted(self):
        worldbook = source("src/features/settings/WorldbookSettings.tsx")
        backup = source("src/features/settings/BackupSettings.tsx")
        store = source("src/adapters/standalone/store.ts")
        self.assertIn("saveFile(", worldbook)
        self.assertIn("key === standaloneStateKey", backup)
        self.assertIn('search_api_key: ""', store)

    def test_legacy_font_scale_units_are_compatible(self):
        app = source("src/app/App.tsx")
        panel = source("src/features/settings/SettingsPanel.tsx")
        self.assertIn("rawScale > 5 ? rawScale / 100 : rawScale", app)
        self.assertIn('min="85" max="130"', panel)

    def test_mobile_question_cards_have_feedback_and_touch_target(self):
        messages = source("src/features/chat/MessageList.tsx")
        styles = source("src/app/styles.css")
        self.assertIn("questionSelections", messages)
        self.assertIn('aria-pressed={selected}', messages)
        self.assertIn("min-height: 44px", styles)
        self.assertIn("touch-action: manipulation", styles)

    def test_provider_probe_never_forces_thinking(self):
        native = source("android/app/src/main/java/app/atherloom/react/MainActivity.java")
        self.assertIn('.put("thinking_enabled", false)', native)
        self.assertIn('boolean explicitThinking = "glm".equals(protocol)', native)

    def test_huawei_long_press_uses_proven_touch_window(self):
        sidebar = source("src/features/shell/Sidebar.tsx")
        self.assertIn("}, 320);", sidebar)
        self.assertIn("onTouchCancel={cancelPress}", sidebar)
        self.assertIn("Math.hypot", sidebar)
        self.assertIn("> 12", sidebar)

    def test_http_errors_keep_status_and_android_back_closes_layers(self):
        client = source("src/adapters/fastapi/client.ts")
        app = source("src/app/App.tsx")
        native = source("android/app/src/main/java/app/atherloom/react/MainActivity.java")
        self.assertIn("HTTP ${response.status}", client)
        self.assertIn('addEventListener("atherloom:back"', app)
        self.assertIn("new Event('atherloom:back',{cancelable:true})", native)

    def test_provider_edit_reuses_encrypted_key_for_models_and_probe(self):
        provider = source("src/features/settings/ProviderSettings.tsx")
        native = source("android/app/src/main/java/app/atherloom/react/MainActivity.java")
        self.assertIn("provider_id: editingId", provider)
        self.assertIn("source_provider_id: editingId", provider)
        self.assertIn("secureProvider(sourceId)", native)
        self.assertIn('"models".equals(operation)', native)
        self.assertIn('"test".equals(operation)', native)

    def test_bulk_clear_stays_inside_current_persona_and_keeps_blank_state(self):
        workspace = source("src/features/workspace/useWorkspace.ts")
        block = workspace[workspace.index("const clearPersonaConversations"):workspace.index("const renameConversation")]
        self.assertIn("item.persona_id || null) === personaId", block)
        self.assertIn("setCurrentId(null)", block)
        self.assertNotIn("createConversation", block)

    def test_exports_are_redacted_and_roleplay_reply_is_archived(self):
        app = source("src/app/App.tsx")
        hub = source("src/features/spaces/FeatureHub.tsx")
        self.assertIn("[已隐藏 API Key]", app)
        self.assertIn("系统提示、思考过程、附件原始数据和密钥已排除", app)
        self.assertIn("response?.trim()", hub)
        self.assertIn('role: "assistant"', hub)

    def test_service_worker_never_forces_a_live_page_reload(self):
        worker = source("public/service-worker.js")
        main = source("src/main.tsx")
        self.assertIn("serviceWorker.register", main)
        self.assertNotIn("skipWaiting", worker)
        self.assertNotIn("location.reload", worker)


if __name__ == "__main__":
    unittest.main()
