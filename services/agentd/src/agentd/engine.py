"""Run engines. Two ways to get a real LLM working a task:

- AnthropicEngine: Anthropic SDK tool loop; tools come from a real MCP
  filesystem server (npx @modelcontextprotocol/server-filesystem) jailed
  to the agent workspace. Needs ANTHROPIC_API_KEY.
- ClaudeCLIEngine: drives the local `claude` CLI in print mode with its
  existing auth, cwd-jailed to the workspace. No API key needed.

Both must end with a JSON verdict the runner can trust-but-verify."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("agentd.engine")

VERDICT_INSTRUCTIONS = """
When the work is complete, your FINAL message must end with a fenced json block:

```json
{"result_summary": "<3-5 sentences: what you did and how it satisfies the criteria>",
 "criteria_met": ["<id of every acceptance criterion you verified>"],
 "evidence_files": ["<workspace-relative path of each file that proves the work>"]}
```

Rules: only list a criterion in criteria_met if you actually verified it.
Every run with proof_required needs at least one evidence file you created.
"""


@dataclass
class RunResult:
    ok: bool
    result_summary: str
    criteria_met: list[str] = field(default_factory=list)
    evidence_files: list[str] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    model: str = ""
    error: str | None = None


def build_prompt(task_doc: dict[str, Any]) -> str:
    task = task_doc["task"]
    criteria = task.get("acceptance_criteria") or []
    lines = [
        f"# Task: {task['title']}",
        "",
        task.get("description") or "(no description)",
        "",
        "## Acceptance criteria (verify each one before claiming it):",
    ]
    for c in criteria:
        lines.append(f"- [{c['id']}] {c['text']}")
    lines.append(f"\nproof_required: {task.get('proof_required', True)}")
    comments = task_doc.get("comments") or []
    if comments:
        lines.append("\n## Recent thread (newest first):")
        for cm in comments[:5]:
            lines.append(f"- ({cm['author_type']}/{cm['kind']}) {str(cm['body'])[:300]}")
    lines.append(
        "\nWork entirely inside the current directory (your workspace jail). "
        "Create real files as your deliverables — they will be attached as evidence."
    )
    lines.append(VERDICT_INSTRUCTIONS)
    return "\n".join(lines)


def parse_verdict(text: str) -> dict[str, Any] | None:
    blocks = re.findall(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    for raw in reversed(blocks):
        try:
            v = json.loads(raw)
            if "result_summary" in v:
                return v
        except json.JSONDecodeError:
            continue
    # last-ditch: bare JSON object at the end
    m = re.search(r"\{[^{}]*\"result_summary\".*\}\s*$", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return None


class ClaudeCLIEngine:
    """`claude -p` with file tools, jailed to the workspace via cwd + acceptEdits."""

    def __init__(self, model: str | None, max_turns: int):
        self.model = model
        self.max_turns = max_turns

    def run(self, prompt: str, system_prompt: str, workspace: Path) -> RunResult:
        cmd = [
            "claude", "-p", prompt,
            "--output-format", "json",
            "--max-turns", str(self.max_turns),
            "--allowed-tools", "Read,Write,Edit",
            "--permission-mode", "acceptEdits",
            "--append-system-prompt", system_prompt,
        ]
        if self.model:
            cmd += ["--model", self.model]
        # Scrub inherited Claude-Code/session env so the CLI uses its own
        # stored auth instead of a parent session's proxy credentials.
        env = {
            k: v for k, v in os.environ.items()
            if not k.startswith(("ANTHROPIC_", "CLAUDE_CODE_")) and k != "CLAUDECODE"
        }
        log.info("claude-cli engine: starting run in %s", workspace)
        proc = subprocess.run(
            cmd, cwd=workspace, capture_output=True, text=True, timeout=900, env=env,
        )
        if proc.returncode != 0 and not proc.stdout.strip():
            return RunResult(ok=False, result_summary="claude CLI failed",
                             error=proc.stderr[-2000:], model=self.model or "claude-cli")
        try:
            out = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return RunResult(ok=False, result_summary="claude CLI returned non-JSON",
                             error=proc.stdout[-2000:], model=self.model or "claude-cli")

        usage = out.get("usage") or {}
        text = out.get("result") or ""
        verdict = parse_verdict(text)
        ok = not out.get("is_error", False) and verdict is not None
        return RunResult(
            ok=ok,
            result_summary=(verdict or {}).get("result_summary", text[:500] or "no output"),
            criteria_met=list((verdict or {}).get("criteria_met", [])),
            evidence_files=list((verdict or {}).get("evidence_files", [])),
            tokens_in=int(usage.get("input_tokens", 0)),
            tokens_out=int(usage.get("output_tokens", 0)),
            cost_usd=float(out.get("total_cost_usd", 0.0)),
            model=self.model or "claude-cli",
            error=None if ok else "no verdict block in final message",
        )


class AnthropicEngine:
    """Anthropic SDK loop with tools served by a real MCP filesystem server."""

    def __init__(self, model: str, max_turns: int, prices: dict[str, Any]):
        self.model = model
        self.max_turns = max_turns
        self.prices = prices

    def _price(self, tokens_in: int, tokens_out: int) -> float:
        p = self.prices.get(self.model)
        if p is None and self.prices:
            # unknown model → most expensive known price, pessimistic (DETAILS §7.2)
            p = max(self.prices.values(), key=lambda x: float(x["out_per_mtok"]))
        if p is None:
            return 0.0
        return (tokens_in * float(p["in_per_mtok"]) + tokens_out * float(p["out_per_mtok"])) / 1_000_000

    def run(self, prompt: str, system_prompt: str, workspace: Path) -> RunResult:
        return asyncio.run(self._run(prompt, system_prompt, workspace))

    async def _run(self, prompt: str, system_prompt: str, workspace: Path) -> RunResult:
        import anthropic
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        client = anthropic.AsyncAnthropic()
        params = StdioServerParameters(
            command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem", str(workspace)],
        )
        total_in = total_out = 0

        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                mcp_tools = (await session.list_tools()).tools
                tools = [{
                    "name": t.name,
                    "description": t.description or "",
                    "input_schema": t.inputSchema,
                } for t in mcp_tools]

                messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
                final_text = ""
                for _ in range(self.max_turns):
                    resp = await client.messages.create(
                        model=self.model,
                        max_tokens=4096,
                        system=system_prompt,
                        messages=messages,  # type: ignore[arg-type]
                        tools=tools,  # type: ignore[arg-type]
                    )
                    total_in += resp.usage.input_tokens
                    total_out += resp.usage.output_tokens
                    tool_uses = [b for b in resp.content if b.type == "tool_use"]
                    text_parts = [b.text for b in resp.content if b.type == "text"]
                    if text_parts:
                        final_text = "\n".join(text_parts)
                    if not tool_uses:
                        break
                    messages.append({"role": "assistant", "content": resp.content})
                    results = []
                    for tu in tool_uses:
                        try:
                            out = await session.call_tool(tu.name, dict(tu.input))  # type: ignore[arg-type]
                            content = "\n".join(
                                c.text for c in out.content if getattr(c, "type", "") == "text"
                            )
                        except Exception as exc:  # tool failure goes back to the model
                            content = f"tool error: {exc}"
                        results.append({
                            "type": "tool_result", "tool_use_id": tu.id, "content": content[:20_000],
                        })
                    messages.append({"role": "user", "content": results})

        verdict = parse_verdict(final_text)
        ok = verdict is not None
        return RunResult(
            ok=ok,
            result_summary=(verdict or {}).get("result_summary", final_text[:500] or "no output"),
            criteria_met=list((verdict or {}).get("criteria_met", [])),
            evidence_files=list((verdict or {}).get("evidence_files", [])),
            tokens_in=total_in,
            tokens_out=total_out,
            cost_usd=self._price(total_in, total_out),
            model=self.model,
            error=None if ok else "no verdict block in final message",
        )
