# starquix-mcp

The MCP relay that lets a coding agent (Claude Code, Codex, Cursor, or any agent with a shell) edit the project open in the Starquix desktop app. The agent gets the same tools as the in-app chat (`add_page`, `add_page_content`, `update_element_by_key`, `write_file`, the `read_*` tools, …) plus `get_project`.

## In the desktop app

The relay ships inside the app. No npm package or Node install is needed.

- **Built-in terminal:** run `claude`, `codex` or `opencode` in the Terminal tab. They already have the Starquix tools there.
- **Any other agent:** AI Settings → MCP → **Copy prompt**, and paste it into the agent. The prompt connects the agent through the launcher `~/.starquix-mcp/bin/starquix-mcp` and asks it to register a stdio MCP server named `starquix` that runs the same launcher.

The app and the relay share one identity file, `~/.starquix-mcp/daemon.json` (token, ports, last project). When the app isn't running, the agent sees the cached tool list and calls answer `NOT_CONNECTED`.

## Commands

| Command | Does |
|---|---|
| `pair --code X [--wait s]` | adopt the app's connect code and wait for the editor to connect |
| `status` / `code` / `up` / `down` | daemon state, the connect code, start, stop |
| `tools` / `call <tool> [json]` | list the tools / call one from a shell (exit 1 + `{error, message}` on failure) |
| *(no command)* | stdio MCP server over the daemon |

## Results and errors

Results are the tool's JSON. Failures carry a code: `NOT_CONNECTED` (app closed or project booting) · `INVALID_ARGS` (schema message) · `TOOL_FAILED` · `NEEDS_CONFIRMATION` (`deploy_project` without `confirm:true` — ask the user, re-run with it after a yes) · `TIMEOUT` (60 s; 180 s `generate_image`) · `DISCONNECTED` (editor reloaded mid-call). Every call is one undo step in the editor, and files are written before the result returns, so `read_file` after a write sees the write.

## Development

```bash
cd mcp && npm run test:run && npm run build   # → dist/cli.js
node scripts/probe.mjs                          # real stdio client: prints the code, waits for the editor, runs a scripted sequence
```
