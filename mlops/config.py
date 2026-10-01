from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


@lru_cache
def load_config() -> dict:
    return yaml.safe_load((ROOT / "configs" / "platform.yaml").read_text(encoding="utf-8"))


def resolve(path: str | Path) -> Path:
    path = Path(path)
    return path if path.is_absolute() else ROOT / path
