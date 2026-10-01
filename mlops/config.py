import os
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


@lru_cache
def load_config() -> dict:
    """configs/platform.yaml, with the keys of the file named by MLOPS_CONFIG on top (Docker addresses)."""
    cfg = yaml.safe_load((ROOT / "configs" / "platform.yaml").read_text(encoding="utf-8"))
    extra = os.environ.get("MLOPS_CONFIG")
    if extra:
        cfg.update(yaml.safe_load(resolve(extra).read_text(encoding="utf-8")) or {})
    cfg.setdefault("service_host", "127.0.0.1")
    cfg.setdefault("public_tracking_uri", cfg["tracking_uri"])
    cfg.setdefault("public_prometheus_url", cfg["prometheus_url"])
    return cfg


def resolve(path: str | Path) -> Path:
    path = Path(path)
    return path if path.is_absolute() else ROOT / path
