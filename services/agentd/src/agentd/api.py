"""HTTP client for the daemon-facing API surface. Every write carries an
idempotency key (run_id + seq) so retries never double-post (DETAILS §9.9)."""

from __future__ import annotations

import itertools
import logging
from typing import Any

import httpx

log = logging.getLogger("agentd.api")


class ApiClient:
    def __init__(self, base_url: str):
        self.http = httpx.Client(base_url=base_url, timeout=30.0)
        self._seq = itertools.count(1)

    def _post(self, path: str, run_id: str, body: dict[str, Any]) -> dict[str, Any]:
        key = f"{run_id}:{next(self._seq)}"
        for attempt in range(3):
            try:
                r = self.http.post(path, json=body, headers={"Idempotency-Key": key})
                r.raise_for_status()
                return r.json()
            except httpx.HTTPError as exc:
                log.warning("POST %s failed (attempt %d): %s", path, attempt + 1, exc)
                if attempt == 2:
                    raise
        raise RuntimeError("unreachable")

    def comment(self, run_id: str, body: str, kind: str = "status_update") -> None:
        self._post(f"/d/runs/{run_id}/comments", run_id, {"body": body, "kind": kind})

    def progress(self, run_id: str, note: str, pct: float | None = None) -> None:
        self._post(f"/d/runs/{run_id}/progress", run_id, {"note": note, "pct": pct})

    def cost(self, run_id: str, model: str, tokens_in: int, tokens_out: int, cost_usd: float) -> None:
        self._post(f"/d/runs/{run_id}/costs", run_id, {
            "model": model, "tokens_in": tokens_in,
            "tokens_out": tokens_out, "cost_usd": cost_usd,
        })

    def artifact(self, run_id: str, name: str, content: str,
                 kind: str = "file", is_evidence: bool = False,
                 content_type: str = "text/plain") -> None:
        self._post(f"/d/runs/{run_id}/artifacts", run_id, {
            "name": name, "kind": kind, "inline_content": content[:32_000],
            "content_type": content_type, "is_evidence": is_evidence,
        })

    def complete(self, run_id: str, status: str, result_summary: str,
                 criteria_met: list[str] | None = None,
                 error: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._post(f"/d/runs/{run_id}/complete", run_id, {
            "status": status, "result_summary": result_summary,
            "criteria_met": criteria_met or [], "error": error,
        })
