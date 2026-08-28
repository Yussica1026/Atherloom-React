import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "0.2.7"
EXPECTED_VERSION_CODE = 14


class ReleaseContracts(unittest.TestCase):
    def test_web_and_android_versions_move_together(self) -> None:
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        gradle = (ROOT / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
        runtime = (ROOT / "src" / "features" / "settings" / "RuntimeSettings.tsx").read_text(encoding="utf-8")
        diagnostics = (ROOT / "src" / "features" / "diagnostics" / "store.ts").read_text(encoding="utf-8")
        service_worker = (ROOT / "public" / "service-worker.js").read_text(encoding="utf-8")

        self.assertEqual(EXPECTED_VERSION, package["version"])
        self.assertEqual(EXPECTED_VERSION, lock["version"])
        self.assertEqual(EXPECTED_VERSION, lock["packages"][""]["version"])
        self.assertIn(f"versionCode {EXPECTED_VERSION_CODE}", gradle)
        self.assertIn(f"versionName '{EXPECTED_VERSION}-react-release'", gradle)
        self.assertIn(f"Atherloom React {EXPECTED_VERSION} · Android versionCode {EXPECTED_VERSION_CODE}", runtime)
        self.assertIn(f'version: "{EXPECTED_VERSION}"', diagnostics)
        self.assertIn(f'atherloom-react-v{EXPECTED_VERSION}', service_worker)


if __name__ == "__main__":
    unittest.main()
