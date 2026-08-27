from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SMOKES = (
    "react_longworld_gm_smoke.py",
    "react_casual_game_smoke.py",
    "react_casual_rps_smoke.py",
    "react_casual_four_smoke.py",
    "standalone_external_import_smoke.py",
)


def run() -> None:
    for smoke in SMOKES:
        subprocess.run(
            [sys.executable, str(ROOT / "tests" / smoke)],
            cwd=ROOT,
            check=True,
        )
    print("REACT_RELEASE_SMOKES_OK")


if __name__ == "__main__":
    run()
