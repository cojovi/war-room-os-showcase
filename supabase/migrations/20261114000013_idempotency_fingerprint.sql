-- Request effects and replay responses are committed atomically by the API.
-- Empty fingerprints identify legacy keys; these cannot be safely replayed against a new request.
alter table idempotency_keys add column request_fingerprint text not null default '';
