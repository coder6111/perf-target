Perf test target — local server

This folder contains a simple static HTML page and a tiny Node server that exposes endpoints useful for load and performance testing.

Files added:
- `server.js` — lightweight Node server (no dependencies) that serves `performance_test.html` and provides endpoints:
  - `/delay?ms=500` — responds after the requested delay (ms) to simulate network latency.
  - `/cpu?ms=100` — busy-loop on the server for the requested ms to simulate CPU-bound responses.
  - `/error` — returns an HTTP 500 to test error handling.
  - `/stream?chunks=5&delay=200` — chunked transfer response to simulate slow streaming.

How to run (macOS / zsh):

```bash
# from this folder
# prefer npm start which checks for JMeter first
npm run check:jmeter   # check whether JMeter is installed
npm start              # will check for JMeter then start server if present
# if you want to skip the JMeter check (not recommended):
npm run start:force
# open http://localhost:3000/ in your browser
```

Quick test examples:

```bash
# simple delay
curl -s "http://localhost:3000/delay?ms=1000" | jq

# simulate CPU work
curl -s "http://localhost:3000/cpu?ms=200" | jq

# streaming response
curl -N "http://localhost:3000/stream?chunks=5&delay=300"

# returns 500
curl -i "http://localhost:3000/error"
```

Notes and suggestions:
- Use this server as a local target for tools like k6, autocannon, or ApacheBench to practice load testing.
- Keep tests small on your laptop; the `/cpu` endpoint will block the Node event loop for the requested duration.
- For distributed or larger tests, run workers on separate machines or inside containers.

Control API:
- The server starts a control API on the next port (PORT+1 by default). Example endpoints:
  - `POST /run-test` — start a test (JSON body: { url, vus, durationSeconds, engine })
    - Supported engines: `jmeter` (requires JMeter on PATH) and an opt-in `demo` engine (`ALLOW_DEMO=true`).
  - `GET  /test/:id` — query test status and results
  - `GET  /history?limit=50` — fetch recent test history (reads `tests_history.ndjson`)
  - `POST /admin/cleanup-history` — trim history to `maxEntries` (JSON body: { maxEntries }). This endpoint is gated by `ALLOW_ADMIN=true` for safety.

  - `GET /history/download` — download the raw `tests_history.ndjson` file.
  - `POST /admin/seed-history` — append a few fake sample entries for UI testing (gated by `ALLOW_ADMIN=true`).
   - `GET /history/tail` — Server-Sent Events (SSE) live tail of history entries. Useful for UI live updates.
   - `POST /admin/clear-history` — remove the history file (gated by `ALLOW_ADMIN=true`).

Additional notes:
- Concurrency: The server limits concurrent running tests (env `MAX_CONCURRENT_TESTS`, default 3). Extra tests are queued and started when capacity frees.
- Demo mode: enable with `ALLOW_DEMO=true`; demo caps are configurable with `MAX_DEMO_VUS` (default 50) and `MAX_DEMO_DURATION` (default 120 seconds).
- History: test runs (queued/started/completed) are appended to `tests_history.ndjson` in the project folder.
- Admin cleanup: If you don't want to enable `ALLOW_ADMIN`, use the helper `node scripts/cleanup_history.js 1000` to keep the last 1000 entries.
- Installer: On macOS, you can try `npm run install:jmeter` to install JMeter via Homebrew (this script attempts to call `brew`).

Port conflicts and "Upgrade Required":
- If you receive an HTTP 426 "Upgrade Required" when calling the control API, another local tool (for example VS Code Live Preview) may be listening on that port. Check with `lsof -iTCP:<port> -sTCP:LISTEN` to find the process, or start the server with a different `PORT` environment variable.

