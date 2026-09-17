# Architecture

The integration runs one Codex app-server process for the desktop app and terminal clients. The shared process owns the loaded threads and their active turns.

## Components

The installation has these components:

- The LaunchAgent starts the shared app-server after a macOS login.
- `server.py` removes Supacode terminal variables and starts app-server on a loopback WebSocket endpoint.
- The `codex` wrapper routes interactive commands to the shared endpoint.
- The terminal relay forwards each WebSocket frame unchanged.
- The presence observer maps events for the attached thread to Supacode presence signals.
- The `codex-shared` command reports status and controls the service.

## Session flow

The desktop app reads `CODEX_APP_SERVER_WS_URL` from the macOS launch environment. The installer configures that value for newly started desktop app processes.

The terminal wrapper adds `--remote` for interactive commands. The wrapper also adds the current directory when the user does not specify a directory.

In a Supacode terminal, the wrapper puts a local relay between the terminal client and the shared server. The relay tracks the thread ID after a start, resume, or fork request. It emits presence only when the thread directory is inside the current Supacode worktree.

## Failure boundaries

A terminal disconnect closes its relay. The shared app-server and other clients continue to operate.

The controller compares the server version with the desktop Codex binary. If the versions differ, the controller refuses a new attachment and requests a safe restart.

The restart and undo commands inspect loaded threads. They refuse the operation while a thread has an active turn.

## Generated state

The installer writes generated state under `$HOME/.local/share/codex-shared`:

- `config.json` contains executable paths and the loopback endpoint.
- `install-backup.json` contains the prior desktop endpoint and wrapper links.
- `server-state.json` contains the service process and Codex version.
- `logs/` contains the LaunchAgent output.

The repository excludes all generated state.
