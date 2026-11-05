# Runbook: MCP session care

**For an AI agent.**

- **Stale tools:** the stdio `pod-manager` server loads the core once per process. A tool added after it started (`rename_pod`, `panama_place`) is missing until the user types `/mcp` and reconnects. Check `ps -o lstart -p <pid>` of `mcp/server.mjs` against the last merge. The app (Electron) must also be restarted to load new core code: `./start.sh desktop`; never while a gate or release build is running (they share `dist`/vite).
- **Two endpoints:** stdio (this session's tools) and the app's HTTP MCP on `127.0.0.1:8765` (pod manager) and `:8766` (ComfyUI bridge, pointed at the running pod's ComfyUI). The HTTP one is always current but its job table is its own: a job started over stdio is "No such job" there. Use the endpoint that started the job.
- **Call the HTTP MCP:** `curl -X POST localhost:8765/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}'`. In zsh write the aws/curl options out; an unquoted `$VAR` holding several options is not split.
- **Huge outputs** (`panama_job`) are saved to a file: parse with python, never read whole.
- **Spend:** `approved_by` is the person's name; never guess it.

## Log
- 2026-11-05: `rename_pod` and `panama_place` were missing until reconnect/app restart; the HTTP MCP was the workaround.
