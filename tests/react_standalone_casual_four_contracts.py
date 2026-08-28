from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StandaloneCasualFourContracts(unittest.TestCase):
    def test_runtime_transitions_and_private_state(self) -> None:
        completed = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                str(ROOT / "tests" / "standalone_casual_four_runtime.mjs"),
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("standalone casual games runtime: ok", completed.stdout)

    def test_chat_tool_opens_setup_without_model_secret(self) -> None:
        source = (ROOT / "src" / "adapters" / "standalone" / "store.ts").read_text(
            encoding="utf-8"
        )
        tool_start = source.index('if (call.name === "atherloom_open_game")')
        tool_end = source.index("const data = readWritingStore();", tool_start)
        tool = source[tool_start:tool_end]

        for game_id in (
            "tic_tac_toe",
            "rock_paper_scissors",
            "bulls_and_cows",
            "twenty_questions",
            "blackjack",
        ):
            self.assertIn(game_id, tool)
        self.assertIn('blackjack: "21 点"', tool)
        self.assertIn('const blackjackIntent = /', source)
        for alias in ("21\\s*点", "二十一点", "黑杰克", "blackjack"):
            self.assertIn(alias, source)
        intent_start = source.index("const standaloneToolIntent")
        intent_end = source.index(";", intent_start)
        self.assertIn('"iu"', source[intent_start:intent_end])
        self.assertIn('gameId === "bulls_and_cows"', tool)
        self.assertIn("setup_required: true", tool)
        self.assertNotIn("user_secret", tool)
        self.assertNotIn("persona_secret", tool)
        self.assertIn("秘密数字由用户直接在界面输入", source)

    def test_public_api_removes_private_game_state(self) -> None:
        source = (
            ROOT / "src" / "adapters" / "standalone" / "casualGames.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("delete state.user_secret", source)
        self.assertIn("delete state.persona_secret", source)
        self.assertIn("delete state.deck", source)
        self.assertIn('session.game_id === "twenty_questions"', source)
        self.assertIn('session.game_id === "bulls_and_cows"', source)
        self.assertIn('session.game_id === "blackjack"', source)
        self.assertIn("interface PrivateBlackjackState", source)


if __name__ == "__main__":
    unittest.main()
