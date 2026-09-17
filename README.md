# Codex shared sessions

Codex shared sessions lets the Codex desktop app and terminal clients use one local Codex server. A macOS login service keeps the server independent of a terminal window. A Supacode bridge reports the state of an attached task in its worktree.

This project packages a personal integration. The desktop connection override is internal. OpenAI describes the WebSocket transport as experimental and unsupported for production workloads.

## Requirements

- macOS
- The ChatGPT desktop app with Codex
- Node.js 18 or later
- npm
- Python 3
- Supacode for optional worktree presence

## Install

1. Wait for all local Codex tasks to finish.
2. Quit every ChatGPT desktop app instance.
3. Run the installer:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/ukchucktown/codex-shared-sessions/main/install | sh
   ```

4. Add `$HOME/.local/bin` to `PATH` if that directory is not present.
5. Open the ChatGPT desktop app.
6. Open a new terminal.

The command downloads the public repository into a temporary directory. The installer creates a user LaunchAgent. The service listens only on `127.0.0.1`. The installer does not change a repository.

From a local clone, run the same installer with this command:

```sh
./install
```

Use `--codex` when the desktop app is not in `/Applications/ChatGPT.app`:

```sh
curl -fsSL https://raw.githubusercontent.com/ukchucktown/codex-shared-sessions/main/install | sh -s -- --codex /path/to/codex
```

## Use a worktree

Start a new task from the worktree that contains its files:

```sh
cd /path/to/worktree
codex
```

Use `codex resume --all` to join an existing task. Select a task that uses the same worktree as the terminal. Use `codex agents` to see all tasks on the shared server.

Press `Ctrl+D` to disconnect the terminal client. The shared task continues. `Ctrl+C` can interrupt an active turn.

The desktop app can continue a task after the terminal disconnects. A desktop-only task has no Supacode presence until a terminal attaches to it.

## Service commands

Check the service:

```sh
codex-shared status
codex-shared doctor
```

After a desktop app update, restart the server:

```sh
codex-shared restart
```

The restart command refuses to interrupt an active task. Resume terminal tasks after the restart.

Disable the integration:

```sh
codex-shared undo
```

Then quit and reopen the desktop app. The undo command retains conversations, logs, and the installed source files.

## Command routing

The wrapper sends interactive `codex`, `resume`, `fork`, and `agents` commands to the shared server. Other subcommands keep their native behavior. An explicit `--remote` argument selects the requested server. A different `CODEX_HOME` selects the requested Codex environment.

In a Supacode terminal, the wrapper starts a local relay. The relay observes events for the attached task and emits Supacode presence signals. The relay does not route another worktree's task to the current worktree.

## Security

The server and each relay listen on the loopback interface. The relay rejects browser-origin connections. Do not change the listener to a non-loopback address without WebSocket authentication and TLS.

The installer stores no Codex credentials. Codex continues to use the desktop app binary and the existing Codex home directory.

## Design

See [Architecture](docs/architecture.md) for the components and the data flow. See [Troubleshooting](docs/troubleshooting.md) for recovery procedures.

The implementation follows the [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).
