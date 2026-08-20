import os
import sys
import tempfile
from pathlib import Path


legacy_root = Path(__file__).resolve().parents[2] / "claude-local-cn"
run_id = os.environ.get("ATHERLOOM_E2E_RUN_ID", "").strip()
if run_id:
    runtime_root = Path(tempfile.gettempdir()) / f"atherloom-react-e2e-{run_id}"
    runtime_root.mkdir(parents=True, exist_ok=True)
else:
    runtime_root = Path(tempfile.mkdtemp(prefix="atherloom-react-e2e-"))

os.environ["NOWHERE_HOME"] = str(runtime_root / "nowhere")
sys.path.insert(0, str(legacy_root))

from backend import app as app_module  # noqa: E402


app_module.DB_PATH = runtime_root / "local.db"
app = app_module.app
