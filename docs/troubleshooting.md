# Troubleshooting

## The terminal cannot connect

1. Run `codex-shared status`.
2. If the service is stopped, run `codex-shared start`.
3. Examine `$HOME/.local/share/codex-shared/logs/server.err.log` if the service does not start.

## Codex reports a version mismatch

1. Wait for all active tasks to finish.
2. Run `codex-shared restart`.
3. Run `codex resume --all` to reconnect a terminal task.

The server uses the Codex binary in the desktop app. A desktop update can change that binary while the existing service still uses the prior version.

## The desktop app does not show terminal tasks

1. Run `codex-shared status`.
2. Make sure that the desktop connection value matches the reported endpoint.
3. Quit the desktop app.
4. Open the desktop app again.

An app process reads the launch environment when macOS starts that process. An app process that predates installation does not use the shared endpoint.

## Supacode shows no presence

1. Start or resume the task from a Supacode terminal.
2. Make sure that the task directory is inside the current worktree.
3. Keep the terminal client attached while you need presence.

The desktop app can use a shared task without an attached terminal. Supacode presence exists only while the terminal relay can identify the task and its worktree.

## Leave the terminal while the task continues

Press `Ctrl+D`. The terminal client disconnects and the server continues the task.

Do not press `Ctrl+C` to leave an active turn. That key can interrupt the turn.
