from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class ReactLongWorldContracts(unittest.TestCase):
    def test_longworld_is_an_independent_lazy_loaded_feature(self) -> None:
        expected = (
            "src/features/longworld/api.ts",
            "src/features/longworld/types.ts",
            "src/features/longworld/useLongWorld.ts",
            "src/features/longworld/LongWorldHub.tsx",
            "src/features/longworld/NarrativeTurnPanel.tsx",
            "src/features/longworld/templates.ts",
            "src/features/longworld/longworld.css",
        )
        for relative in expected:
            self.assertTrue((ROOT / relative).is_file(), relative)
        app = source("src/app/App.tsx")
        self.assertIn("const LongWorldHub = lazy", app)
        combined = "\n".join(source(relative) for relative in expected)
        self.assertNotIn("features/games", combined)
        self.assertNotIn("adapters/standalone/store", combined)

    def test_api_uses_only_the_isolated_longworld_namespace(self) -> None:
        api = source("src/features/longworld/api.ts")
        self.assertIn('"/api/game-worlds"', api)
        self.assertIn('"/api/game-sessions"', api)
        self.assertIn("/gm-turns?provider_id=", api)
        self.assertNotIn('"/api/games/', api)
        self.assertNotIn('"/api/casual-games/', api)

    def test_commits_remain_revisioned_idempotent_and_server_authoritative(self) -> None:
        engine = source("src/features/longworld/useLongWorld.ts")
        self.assertIn("expected_revision: session.current_revision", engine)
        self.assertIn('idempotency_key: randomId("ui-action")', engine)
        self.assertIn("longWorldApi.commitGMTurn", engine)
        self.assertIn("longWorldApi.commitAction", engine)
        self.assertIn("longWorldApi.getSession(target.sessionId)", engine)
        self.assertIn("committed.idempotent_replay", engine)

    def test_replay_save_and_branch_are_server_operations(self) -> None:
        api = source("src/features/longworld/api.ts")
        engine = source("src/features/longworld/useLongWorld.ts")
        for suffix in ("/replay", "/saves", "/branch"):
            self.assertIn(suffix, api)
        self.assertIn("longWorldApi.replay(session.id)", engine)
        self.assertIn("longWorldApi.createSave", engine)
        self.assertIn("longWorldApi.branchFromSave", engine)

    def test_ui_states_the_narration_fact_boundary(self) -> None:
        panel = source("src/features/longworld/NarrativeTurnPanel.tsx")
        self.assertIn("GM 只能提出候选变化", panel)
        self.assertIn("叙事不是权威事实", panel)
        self.assertIn("只认已提交的领域事件和 revision", panel)

    def test_visuals_follow_existing_theme_and_font_tokens(self) -> None:
        styles = source("src/features/longworld/longworld.css") + source(
            "src/features/longworld/narrative-turn.css"
        )
        self.assertIsNone(re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", styles))
        for token in (
            "var(--bg)",
            "var(--surface)",
            "var(--text)",
            "var(--accent)",
            "var(--border)",
            "var(--font-ui)",
            "var(--serif)",
        ):
            self.assertIn(token, styles)

    def test_empty_player_name_uses_a_neutral_fallback(self) -> None:
        hub = source("src/features/longworld/LongWorldHub.tsx")
        self.assertIn('playerDisplayName.trim() || "玩家"', hub)


if __name__ == "__main__":
    unittest.main()
