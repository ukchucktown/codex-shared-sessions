#!/usr/bin/env python3
"""Run the shared server without a Supacode terminal identity."""

import json
import os
from pathlib import Path
import subprocess


root = Path(__file__).resolve().parent.parent
config = json.loads((root / "config.json").read_text())
env = os.environ.copy()
for key in list(env):
    if key.startswith("SUPACODE_"):
        del env[key]
env["PATH"] = config["path"]

version = subprocess.check_output([config["codex"], "--version"], text=True, env=env).strip()
(root / "server-state.json").write_text(json.dumps({"pid": os.getpid(), "version": version}) + "\n")
subprocess.run(
    ["/bin/launchctl", "setenv", "CODEX_APP_SERVER_WS_URL", config["url"]],
    check=True,
)
os.execve(
    config["codex"],
    [
        config["codex"],
        "-c",
        "features.code_mode_host=true",
        "app-server",
        "--listen",
        config["url"],
    ],
    env,
)

