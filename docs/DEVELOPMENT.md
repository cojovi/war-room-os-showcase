# Local development

Use Node.js 22 or newer, pnpm 11.7.0, Python 3.12+ and uv. The repository contains both the real application and a static replay.

## Reproduce the workflow

Run the quick start in the README. The Compose service exposes PostgreSQL only at `127.0.0.1:55439`; its `showcase` username/password are disposable fixture credentials. Do not use that configuration for a public database.

To use an existing **disposable local PostgreSQL** instance instead:

```bash
export PROOF_ADMIN_URL='postgresql://showcase:showcase@127.0.0.1:55439/postgres'
pnpm demo
```

The account must be able to create and drop databases. The harness creates a uniquely named `wr_proof_*` database and drops that exact database on exit. It rejects remote hosts and instances exposing `pg_cron`; the proof calls the reaper directly rather than installing scheduled jobs.

Ports 8789 (API) and 3107 (dashboard) must be free. The integration runner refuses to start if the API port is occupied. `pnpm test:integration` runs the scenarios and cleans up immediately; `pnpm demo` keeps the local application and fictional data open until Ctrl-C. A hard kill can leave its database or child processes behind; inspect the exact `wr_proof_*` name before manual cleanup.

The API is intentionally local and has no production authentication. The static replay is the only component intended for public hosting.

## Preview the static replay

```bash
python3 -m http.server 5181 --bind 127.0.0.1
```

Open `http://127.0.0.1:5181/demo/`. It fetches `report.json` from the same directory. Scenario controls only navigate saved results. No provider API, backend service, or telemetry is required.

## Project map

- `apps/dashboard`: Next.js application and task interface.
- `apps/api`: Hono/tRPC routes and daemon endpoints.
- `packages/shared`: types, event taxonomy, fictional agent roster and routing.
- `services/agentd`: Python runner and adapters, packaged with uv.
- `supabase`: schema and fictional seed.
- `scripts/prove.py`: integration harness and report writer.
- `tests`: evidence-path regression tests.
- `demo`: standalone replay, bundled font data, recorded report.
- `readme-assets`: editable SVG artwork, screenshots, font attribution.

The dependency locks are checked in. Next.js may retrieve its configured fonts while building. The recorded verification does not require Anthropic credentials or the Claude CLI, because its fixture engine is injected before execution.
