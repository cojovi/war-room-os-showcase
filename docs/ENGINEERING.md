# Engineering notes

War Room OS coordinates agent work around task records instead of treating a model response as the entire product. The useful boundary is the handoff between an execution attempt and the system of record.

## Task claims

[`claim_one`](../services/agentd/src/agentd/db.py) selects pending work using `FOR UPDATE SKIP LOCKED`. Candidates must satisfy assignment/skill requirements, completed dependencies, and the global pause check. The claim, attempt, agent pointer, and events share one database transaction.

The proof harness starts two database sessions against one eligible task and verifies that only one gets a claim and only one run is created. This is a task-claim concurrency check, not a proof of exclusive agent slots across arbitrary parallel workloads.

## Completion is a persisted transition

The runner attaches evidence and submits a success verdict with criterion identifiers. The API updates stored criterion flags and attempts the transition in a savepoint. The database trigger rejects `done` when criteria are unmet or required evidence is absent. The API then routes the task to review.

This is structural validation. An artifact may be wrong; a criterion can be falsely reported as met. Independent semantic verification and human review policies are separate problems. The showcase intentionally demonstrates the missing-artifact failure path.

## Retry-safe writes

The original daemon API cached a response after the mutation transaction. A response-cache failure could leave a committed action without a replay record. The showcase uses one transaction for mutation, event, and replay record.

An advisory transaction lock on the idempotency key serializes competing retries. A SHA-256 fingerprint of method, path, and parsed/serialized JSON body rejects a different request using the same key. This is not JSON canonicalization: reordered object properties may be considered different. Keys are optional; clients must send them for this guarantee. Hash-lock collisions may serialize unrelated requests but do not merge their distinct key records.

The integration harness sends eight concurrent requests for one comment and checks one stored row and identical IDs. It also checks changed-body rejection and rollback: an invalid artifact write leaves no replay record, and a corrected retry using that key succeeds. This covers database side effects; it does not provide exactly-once delivery to an arbitrary external service.

## Recovery and cost controls

The SQL reaper marks stale agents offline and abandons stranded active runs. Eligible tasks are requeued with an incremented retry count; exhausted in-progress attempts can fail. Awaiting-approval runs are excluded. The demonstration ages one heartbeat, invokes the function, confirms a second invocation reaps nothing, and completes the retry. Concurrent reaper execution and scheduler installation are not tested.

Budget headroom is checked before the engine runs. Task/project, agent/day, and global/day balances participate. A zero-budget fixture verifies zero engine invocations. This does not reserve concurrent spend or enforce a hard limit during a provider request. The fixture seed clears model pricing because no real provider charges are incurred.

## Evidence containment

The runner resolves both the evidence path and workspace, then uses `Path.is_relative_to` to reject paths outside that workspace. This replaces a string-prefix comparison that incorrectly accepted similarly named sibling directories. Tests cover normal files, outside absolute paths, sibling-prefix paths, symlinks outside, symlinks inside, and missing files.

This is an application check. It is not an OS sandbox, does not eliminate path-check/read races, and does not constrain every capability of a live model adapter. The runner truncates the text it submits; its current file read is not a bounded streaming read.

## Interface and execution boundaries

Next.js presents the task document, acceptance criteria, comments, artifacts, attempts, and events. Hono exposes tRPC commands and daemon write routes. Python owns the claim/execute/attach/complete flow, with direct database operations for claims and execution status and API calls for comments, artifacts, costs, and completion.

The published replay is a separate static presentation that reads `demo/report.json`. The runnable application uses the actual API and database. Only the engine is replaced during the proof run. Live Anthropic/CLI adapters are present for inspection but are not exercised by the demonstration.

## Useful next engineering work

Production authentication and authorization, run fencing after worker loss, concurrent agent-slot ownership, live-provider evaluation, hard spend reservations, and deployment/load tests would be separate milestones. They are not implied by the current verification record.
