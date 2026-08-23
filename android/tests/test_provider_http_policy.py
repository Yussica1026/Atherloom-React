from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest


ANDROID = Path(__file__).resolve().parents[1]
JAVA = ANDROID / "app" / "src" / "main" / "java" / "app" / "atherloom" / "react"
HARNESS = ANDROID / "tests" / "java" / "app" / "atherloom" / "react" / "ProviderEndpointPolicyHarness.java"


def jdk_tool(name: str) -> str | None:
    executable = f"{name}.exe" if os.name == "nt" else name
    found = shutil.which(executable) or shutil.which(name)
    if found:
        return found
    candidates: list[Path] = []
    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        candidates.append(Path(java_home) / "bin" / executable)
    if os.name == "nt":
        program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        candidates.extend((program_files / "Android" / "Android Studio" / "jbr" / "bin").glob(executable))
        candidates.extend((program_files / "JetBrains").glob(f"*/jbr/bin/{executable}"))
    return next((str(candidate) for candidate in candidates if candidate.is_file()), None)


class ProviderEndpointPolicyTests(unittest.TestCase):
    def test_pure_java_policy_and_redirect_behavior(self) -> None:
        javac = jdk_tool("javac")
        java = jdk_tool("java")
        self.assertIsNotNone(javac, "JDK javac is required for the Android provider policy contract")
        self.assertIsNotNone(java, "JDK java is required for the Android provider policy contract")
        with tempfile.TemporaryDirectory() as output:
            compile_result = subprocess.run(
                [
                    javac,
                    "--add-modules",
                    "jdk.httpserver",
                    "-encoding",
                    "UTF-8",
                    "-d",
                    output,
                    str(JAVA / "ProviderEndpointPolicy.java"),
                    str(HARNESS),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            self.assertEqual(0, compile_result.returncode, compile_result.stdout + compile_result.stderr)
            run_result = subprocess.run(
                [
                    java,
                    "--add-modules",
                    "jdk.httpserver",
                    "-cp",
                    output,
                    "app.atherloom.react.ProviderEndpointPolicyHarness",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            self.assertEqual(0, run_result.returncode, run_result.stdout + run_result.stderr)
            self.assertIn("ProviderEndpointPolicyHarness OK", run_result.stdout)

    def test_every_direct_provider_exit_uses_the_policy_and_rejects_redirects(self) -> None:
        activity = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
        direct = activity[
            activity.index("private JSONArray directListModels"):
            activity.index("private static String textValue")
        ]
        self.assertEqual(3, direct.count("ProviderEndpointPolicy.openConnection("))
        self.assertNotIn("new URL(endpoint).openConnection()", direct)
        self.assertEqual(3, direct.count("rejectProviderRedirect(status)"))
        self.assertIn("status < 200 || status >= 300", direct)

    def test_saved_key_reuse_is_bound_to_the_same_provider_scope(self) -> None:
        activity = (JAVA / "MainActivity.java").read_text(encoding="utf-8")
        self.assertIn("canReuseProviderKey(existing, provider)", activity)
        self.assertIn("canReuseProviderKey(saved, provider)", activity)
        self.assertIn("ProviderEndpointPolicy.sameCredentialScope(", activity)
        self.assertNotIn(
            'if (!saved.optString("api_key").isEmpty()) provider.put("api_key"',
            activity,
        )

    def test_react_guards_save_models_and_probe_before_native_http(self) -> None:
        provider = (
            ANDROID.parent / "src" / "features" / "settings" / "ProviderSettings.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("HTTP Direct Provider 会明文传输 API Key、对话和图片", provider)
        for action in (
            "保存这条 Direct Provider 线路",
            "拉取模型列表",
            "测试这条 Direct Provider 线路",
        ):
            self.assertIn(f'approveDirectEndpoint(', provider)
            self.assertIn(action, provider)
        self.assertIn("allow_insecure_http: true", provider)
        self.assertIn("current.base_url.trim() === baseUrl.trim()", provider)


if __name__ == "__main__":
    unittest.main()
