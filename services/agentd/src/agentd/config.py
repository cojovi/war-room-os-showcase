from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv_near(config_path: Path) -> None:
    """Load the nearest .env walking up from the config file (repo root in
    the monorepo, or alongside config.toml on a deployed machine). Real
    environment variables always win over file values."""
    for parent in [config_path.resolve().parent, *config_path.resolve().parents]:
        env_file = parent / ".env"
        if not env_file.is_file():
            continue
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = value
        return


@dataclass
class Config:
    machine_id: str
    agents: list[str] = field(default_factory=list)
    poll_interval: float = 3.0
    heartbeat_interval: float = 5.0
    workspace_root: Path = Path("~/agos/workspaces")
    engine: str = "anthropic"
    max_turns: int = 12
    database_url: str = ""
    api_url: str = "http://localhost:8787"

    @classmethod
    def load(cls, path: str | Path) -> "Config":
        _load_dotenv_near(Path(path))
        with open(path, "rb") as f:
            raw = tomllib.load(f)
        cfg = cls(
            machine_id=raw["machine_id"],
            agents=list(raw.get("agents", [])),
            poll_interval=float(raw.get("poll_interval", 3.0)),
            heartbeat_interval=float(raw.get("heartbeat_interval", 5.0)),
            workspace_root=Path(raw.get("workspace_root", "~/agos/workspaces")).expanduser(),
            engine=raw.get("engine", "anthropic"),
            max_turns=int(raw.get("max_turns", 12)),
        )
        cfg.database_url = os.environ.get(
            "DATABASE_URL", "postgres://postgres:test@localhost:54322/postgres"
        )
        cfg.api_url = os.environ.get("AGOS_API_URL", "http://localhost:8787")
        return cfg

    def workspace_for(self, agent_name: str) -> Path:
        ws = self.workspace_root / agent_name
        ws.mkdir(parents=True, exist_ok=True)
        return ws
