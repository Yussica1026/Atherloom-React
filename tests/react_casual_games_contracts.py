from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class ReactCasualGamesContracts(unittest.TestCase):
    def test_registered_games_are_an_independent_feature(self) -> None:
        expected = (
            "src/features/games/types.ts",
            "src/features/games/api.ts",
            "src/features/games/GameRegistry.ts",
            "src/features/games/GameOverlay.tsx",
            "src/features/games/games.css",
            "src/features/games/hooks/useGameSession.ts",
            "src/features/games/games/tic-tac-toe/TicTacToeGame.tsx",
            "src/features/games/games/rock-paper-scissors/RockPaperScissorsGame.tsx",
        )
        for relative in expected:
            self.assertTrue((ROOT / relative).is_file(), relative)
        self.assertNotIn("casual-game", source("src/adapters/standalone/store.ts").lower())

    def test_only_live_tool_effects_open_the_overlay(self) -> None:
        workspace = source("src/features/workspace/useWorkspace.ts")
        app = source("src/app/App.tsx")
        self.assertIn("queueLiveToolEffect(event.tool_event)", workspace)
        self.assertIn("pendingToolEffects", workspace)
        self.assertIn("consumeToolEffect", workspace)
        self.assertIn("parseOpenGameEffect(pending.event.effect)", app)
        self.assertIn("const GameOverlay = lazy", app)
        self.assertLess(app.index("if (activeGame)"), app.index("else if (callOpen)"))
        self.assertNotRegex(app, r"messages\.(?:find|filter|some).*open_game")

    def test_ui_uses_server_owned_persona_result_and_memory_routes(self) -> None:
        games = "\n".join(
            source(relative)
            for relative in (
                "src/features/games/api.ts",
                "src/features/games/GameOverlay.tsx",
                "src/features/games/hooks/useGameSession.ts",
            )
        )
        for endpoint in ("/actions", "/persona-turn", "/chat-reply", "/memory-decision", "/abandon"):
            self.assertIn(endpoint, games)
        self.assertNotIn("/persona-actions", games)
        self.assertNotIn("/api/memories", games)
        self.assertIn("onConversationUpdated(current.conversation_id)", games)
        self.assertIn('memoryMode !== "auto"', games)
        self.assertIn("void decideMemory(true)", games)

    def test_rock_paper_scissors_waits_for_server_reveal(self) -> None:
        registry = source("src/features/games/GameRegistry.ts")
        game = source("src/features/games/games/rock-paper-scissors/RockPaperScissorsGame.tsx")
        hook = source("src/features/games/hooks/useGameSession.ts")
        self.assertIn('id: "rock_paper_scissors"', registry)
        self.assertIn("RockPaperScissorsGame", registry)
        self.assertIn("pendingUserAction", hook)
        self.assertIn("playAction", hook)
        self.assertRegex(
            game,
            r"const personaChoice = finished\s*\? choiceOf\(state\.persona_choice\)\s*:\s*null",
        )
        self.assertGreaterEqual(game.count("revealed={finished}"), 2)
        self.assertNotRegex(game, r"Math\.random|BEATS|winner\s*=|outcome\s*=")
        self.assertIn("结果由规则引擎确认", game)

    def test_game_visuals_only_use_existing_theme_and_font_tokens(self) -> None:
        styles = source("src/features/games/games.css")
        self.assertIsNone(re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(", styles))
        for token in ("var(--bg)", "var(--surface)", "var(--text)", "var(--accent)", "var(--border)", "var(--font-body)", "var(--font-ui)", "var(--serif)"):
            self.assertIn(token, styles)
        self.assertIn("@media (prefers-reduced-motion: reduce)", styles)
        self.assertIn("height: 100dvh", styles)
        overlay = source("src/features/games/GameOverlay.tsx")
        self.assertIn('setAttribute("inert", "")', overlay)
        self.assertIn('event.key === "Escape"', overlay)
        self.assertIn('aria-modal="true"', overlay)


if __name__ == "__main__":
    unittest.main()
