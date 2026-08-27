from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class ExternalImportTransportContracts(unittest.TestCase):
    def test_browser_uploads_original_file_bytes(self) -> None:
        api = source("src/features/imports/api.ts")
        self.assertIn("/api/imports/preview-file?", api)
        self.assertIn('"Content-Type": "application/octet-stream"', api)
        self.assertIn("body: file", api)
        self.assertIn("if (!window.AtherloomNative) return previewBrowserFile(file)", api)

    def test_android_streams_selected_uri_without_base64_copy(self) -> None:
        activity = source("android/app/src/main/java/app/atherloom/react/MainActivity.java")
        types = source("src/vite-env.d.ts")
        client = source("src/adapters/fastapi/client.ts")
        self.assertIn("previewImportFileAsync", types)
        self.assertIn("requestNativeImportPreview", client)
        self.assertIn("activity.lastOpenedFileUri", activity)
        self.assertIn("getContentResolver().openInputStream(selectedUri)", activity)
        self.assertIn("setChunkedStreamingMode(64 * 1024)", activity)
        self.assertIn('"/api/imports/preview-file?source_name="', activity)

    def test_older_apk_keeps_encoded_compatibility_path(self) -> None:
        api = source("src/features/imports/api.ts")
        self.assertIn("Compatibility path for an older APK", api)
        self.assertIn("/api/imports/preview-encoded", api)

    def test_android_standalone_uses_the_local_canonical_importer(self) -> None:
        api = source("src/features/imports/api.ts")
        store = source("src/adapters/standalone/store.ts")
        importer = source("src/adapters/standalone/imports.ts")
        self.assertIn("if (isStandaloneAndroid())", api)
        self.assertIn("previewStandaloneExternalImportFile(file)", api)
        self.assertIn("isStandaloneImportPath(path)", store)
        self.assertIn('import { unzipSync } from "fflate"', importer)
        self.assertNotIn("DecompressionStream", importer)

    def test_standalone_parser_keeps_current_branches_and_kelivo_top_level_tables(self) -> None:
        importer = source("src/adapters/standalone/imports.ts")
        self.assertIn("selectedPath.reverse()", importer)
        self.assertIn("current_leaf_message_uuid", importer)
        self.assertIn("Array.isArray(backup.conversations) && Array.isArray(backup.messages)", importer)
        self.assertIn("versionSelections", importer)
        self.assertIn("geminiThoughtSigs", importer)

    def test_standalone_commit_is_compensated_and_records_only_committed_sources(self) -> None:
        importer = source("src/adapters/standalone/imports.ts")
        store = source("src/adapters/standalone/store.ts")
        domain = source("src/domain/types.ts")
        self.assertIn("batch.source_keys = imported.map", importer)
        self.assertIn("canonicalIdCounts", importer)
        self.assertIn("duplicates.add(sourceKey(conversation))", importer)
        self.assertIn("runtime.writeWorkspace(workspace)", importer)
        self.assertIn("transaction.onabort", importer)
        self.assertIn("withWorkspaceOperation", importer)
        self.assertIn("readStateForMutation", store)
        self.assertIn("已停止导入以避免覆盖旧数据", store)
        self.assertIn("external_import?: ExternalImportProvenance", domain)


if __name__ == "__main__":
    unittest.main()
