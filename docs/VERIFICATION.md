# Verification record

Recorded locally on 2026-11-14. See [`demo/report.json`](../demo/report.json) for assertion names and timestamp, and [GitHub Actions](https://github.com/cojovi/war-room-os-showcase/actions/workflows/verify.yml) for subsequent runs against PostgreSQL 16.

| Check | Local result | Scope |
| --- | --- | --- |
| Integration demonstration | 22 passed | Actual PostgreSQL 14.23, Hono API, Python claim/runner; deterministic engine |
| Evidence-path regression tests | 6 passed | In-workspace, missing, absolute outside, sibling-prefix, and symlink paths |
| TypeScript | Passed | All workspace typecheck commands |
| Production build | Passed | API/shared compilation and Next.js production build |
| Source database gate | 22 passed | Original private project's schema tests on an isolated native PostgreSQL 14.23 cluster |

The source database gate is separate from the 22 showcase integration assertions. Its Docker launcher was adapted locally to use the isolated native cluster; its assertion body used the corrected cost fixture. The source seed was fixed to tolerate agents already created by the roster migration. That private roster is not published here.

## Reproduce

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project services/agentd
docker compose up -d --wait
pnpm test:unit
pnpm test:integration
pnpm typecheck
pnpm build
docker compose down
```

The supplied Compose file and CI service target PostgreSQL 16. The local launch used native PostgreSQL 14.23 because Docker was unavailable. CI results are reported separately rather than claiming the local run used Docker.

## What the checks do not establish

No live model calls were made. There is no benchmark claim about model quality, token cost, throughput, production uptime, or multi-machine deployment. The demonstration does not test production authorization, concurrent reaping, operating-system sandboxing, exact in-flight spend control, or crash recovery across every process boundary.

The public replay reads a checked-in report. A local integration run regenerates that file; CI does not automatically commit new reports. CI failure will not replace the recorded successful report.
