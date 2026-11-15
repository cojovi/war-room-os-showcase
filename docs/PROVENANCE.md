# Provenance and public scope

War Room OS was designed and built by Cody / COJOVI with AI-assisted development. This repository is a curated public source release from the private `War_Room_os` project, based on commit `b7754dbf0db3d89ae7fb27db13db3140066128e6` and the showcase fixes described below. It has its own history.

## Included

- Next.js dashboard and Hono/tRPC API implementation.
- Shared task types, status definitions, and agent selection logic.
- PostgreSQL schema, transitions, event/cost storage, and heartbeat reaper.
- Python database, runner, API client, config types, and engine adapters.
- New disposable-database integration harness and evidence-path regression tests.
- Original showcase artwork and an interactive replay of recorded results.

## Adapted for publication

- Agent roster, project, machine identifiers, and task data are fictional fixtures.
- The API binds to loopback and accepts the local demonstration UI origins.
- Operational machine labels in the UI are replaced with explicit showcase labels; runner comments show only the workspace name, not its absolute local path.
- The private daemon launcher and service entrypoint are omitted; the demonstration calls the real runner directly with a deterministic engine.
- The private roster migration is omitted. Generic schema migrations retain their source filenames, so there is a deliberate numbering gap before the new fingerprint migration.
- Idempotent daemon mutations now share a transaction with their response cache and compare request fingerprints.
- Evidence containment uses resolved path ancestry; a shared TypeScript export was fixed for the Next.js build.

## Excluded

Private deployment/runbooks, local credentials, host addresses, operational agent instructions, billing details, workstation configuration, private data, and the original Git history are not part of this release. The private repository's visibility is unchanged.

The replay's stages are explanatory labels around verified outcomes. Its saved report records assertions, fictional scenario outcomes, and event metadata; it is not a full timing trace or a live view of deployed agents.

No application license is granted by this document. Dependency and font licenses remain with their respective owners; bundled font notices are in `readme-assets/FONT-LICENSES.txt`.
