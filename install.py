#!/usr/bin/env python3
"""Install a shared local Codex server for desktop and terminal clients."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen


LABEL = "local.codex.shared-server"
DEFAULT_CODEX = Path("/Applications/ChatGPT.app/Contents/Resources/codex")
SOURCE_FILES = (
    "connection.mjs",
    "control.mjs",
    "launcher.mjs",
    "presence.mjs",
    "relay.mjs",
    "server.py",
)


def parse_args() -> argparse.Namespace:
    home = Path.home()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=53181)
    parser.add_argument("--codex", type=Path)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--npm", type=Path)
    parser.add_argument("--target", type=Path, default=home / ".local/share/codex-shared")
    parser.add_argument("--bin-dir", type=Path, default=home / ".local/bin")
    return parser.parse_args()


def executable(value: Path | None, name: str, fallback: Path | None = None) -> Path:
    candidate = value
    if candidate is None and fallback is not None and fallback.exists():
        candidate = fallback
    if candidate is None:
        found = shutil.which(name)
        candidate = Path(found) if found else None
    if candidate is None or not candidate.exists() or not os.access(candidate, os.X_OK):
        raise SystemExit(f"Cannot find an executable {name} command. Use --{name} to specify it.")
    return candidate.resolve()


def check_port(port: int) -> None:
    if not 1 <= port <= 65535:
        raise SystemExit("The port must be between 1 and 65535.")
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as error:
            raise SystemExit(f"Port {port} is not available: {error}") from error


def command_output(command: list[str]) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()


def wait_until_ready(port: int) -> None:
    endpoint = f"http://127.0.0.1:{port}/readyz"
    for _ in range(40):
        try:
            with urlopen(endpoint, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.25)
    raise RuntimeError("The shared server did not become ready. Examine the service error log.")


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit("This installer supports macOS only.")

    args = parse_args()
    source = Path(__file__).resolve().parent
    target = args.target.expanduser().resolve()
    bin_dir = args.bin_dir.expanduser().resolve()
    home = Path.home().resolve()
    plist = home / "Library/LaunchAgents" / f"{LABEL}.plist"
    codex = executable(args.codex, "codex", DEFAULT_CODEX)
    node = executable(args.node, "node")
    npm = executable(args.npm, "npm")

    if target.exists() or plist.exists():
        raise SystemExit("An existing shared installation needs review before installation.")

    bin_dir.mkdir(parents=True, exist_ok=True)
    wrapper_paths = [bin_dir / "codex", bin_dir / "codex-shared"]
    for wrapper in wrapper_paths:
        if os.path.lexists(wrapper):
            raise SystemExit(f"An existing command needs review: {wrapper}")

    check_port(args.port)
    command_output([str(codex), "--version"])
    command_output([str(node), "--version"])
    command_output([str(npm), "--version"])

    url = f"ws://127.0.0.1:{args.port}"
    path_parts = [str(bin_dir), str(node.parent), str(codex.parent), "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    config = {
        "label": LABEL,
        "url": url,
        "codex": str(codex),
        "node": str(node),
        "codexHome": str(home / ".codex"),
        "path": ":".join(dict.fromkeys(path_parts)),
        "plist": str(plist),
    }

    prior_url = command_output(["/bin/launchctl", "getenv", "CODEX_APP_SERVER_WS_URL"])
    wrappers: list[dict[str, str]] = []
    try:
        target.mkdir(parents=True, mode=0o700)
        (target / "src").mkdir(mode=0o700)
        (target / "logs").mkdir(mode=0o700)
        for name in SOURCE_FILES:
            shutil.copy2(source / "src" / name, target / "src" / name)
        shutil.copy2(source / "package.json", target / "package.json")
        shutil.copy2(source / "package-lock.json", target / "package-lock.json")
        (target / "config.json").write_text(json.dumps(config, indent=2) + "\n")
        os.chmod(target / "config.json", 0o600)
        subprocess.run([str(npm), "ci", "--omit=dev"], cwd=target, check=True)

        for name, module in (("codex", "launcher.mjs"), ("codex-shared", "control.mjs")):
            script = target / name
            script.write_text(
                "#!/bin/sh\nexec "
                + shlex.quote(str(node))
                + " "
                + shlex.quote(str(target / "src" / module))
                + ' "$@"\n'
            )
            script.chmod(0o700)
            link = bin_dir / name
            link.symlink_to(script)
            wrappers.append({"path": str(link), "target": str(script)})

        backup = {"desktopUrl": prior_url, "wrappers": wrappers}
        (target / "install-backup.json").write_text(json.dumps(backup, indent=2) + "\n")
        os.chmod(target / "install-backup.json", 0o600)

        plist.parent.mkdir(parents=True, exist_ok=True)
        with plist.open("wb") as output:
            plistlib.dump(
                {
                    "Label": LABEL,
                    "ProgramArguments": ["/usr/bin/python3", str(target / "src" / "server.py")],
                    "WorkingDirectory": str(home),
                    "RunAtLoad": True,
                    "KeepAlive": True,
                    "ThrottleInterval": 10,
                    "StandardOutPath": str(target / "logs/server.out.log"),
                    "StandardErrorPath": str(target / "logs/server.err.log"),
                    "EnvironmentVariables": {"PATH": config["path"]},
                },
                output,
            )
        subprocess.run(["/bin/launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], check=True)
        wait_until_ready(args.port)
    except Exception:
        subprocess.run(["/bin/launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"], check=False)
        for wrapper in wrappers:
            Path(wrapper["path"]).unlink(missing_ok=True)
        plist.unlink(missing_ok=True)
        raise

    print(f"Installed the shared Codex service at {target}")
    print(f"Endpoint: {url}")
    if str(bin_dir) not in os.environ.get("PATH", "").split(os.pathsep):
        print(f"Add {bin_dir} to PATH, then open a new terminal.")
    print("Quit and reopen the ChatGPT desktop app.")


if __name__ == "__main__":
    main()

