from dataclasses import dataclass, field
from pathlib import Path

import yaml

REQUIRED_ENTRYPOINTS = ("train", "evaluate")


class ContractError(ValueError):
    pass


@dataclass
class Entrypoint:
    name: str
    command: str
    config: str | None = None
    outputs: dict[str, str] = field(default_factory=dict)
    port: int | None = None


@dataclass
class DatasetSlot:
    name: str
    mount: str


@dataclass
class Project:
    root: Path
    name: str
    image: str
    workdir: str
    shm_size: str | None
    entrypoints: dict[str, Entrypoint]
    datasets: dict[str, DatasetSlot]
    metrics: dict
    raw: dict


def load_project(root: str | Path) -> Project:
    root = Path(root).resolve()
    path = root / "project.yaml"
    if not path.is_file():
        raise ContractError(f"{path} not found")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    for key in ("name", "image", "entrypoints", "metrics"):
        if key not in data:
            raise ContractError(f"missing field: {key}")

    entrypoints = {}
    for name, spec in (data["entrypoints"] or {}).items():
        if not isinstance(spec, dict) or not spec.get("command"):
            raise ContractError(f"entrypoints.{name}: missing command")
        outputs = spec.get("outputs") or {}
        if not isinstance(outputs, dict):
            raise ContractError(f"entrypoints.{name}.outputs must be a mapping")
        entrypoints[name] = Entrypoint(name, spec["command"], spec.get("config"), outputs, spec.get("port"))

    missing = [n for n in REQUIRED_ENTRYPOINTS if n not in entrypoints]
    if missing:
        raise ContractError(f"missing entrypoints: {', '.join(missing)}")

    slots = {}
    for spec in data.get("datasets") or []:
        if not isinstance(spec, dict) or not spec.get("name") or not spec.get("mount"):
            raise ContractError("each dataset needs a name and a mount")
        if spec["mount"].startswith("/") or ".." in Path(spec["mount"]).parts:
            raise ContractError(f"datasets.{spec['name']}.mount must be relative to the project root")
        slots[spec["name"]] = DatasetSlot(spec["name"], spec["mount"])

    metrics = data["metrics"] or {}
    for key in ("primary", "higher_is_better"):
        if key not in metrics:
            raise ContractError(f"missing field: metrics.{key}")

    return Project(
        root=root,
        name=data["name"],
        image=data["image"],
        workdir=data.get("workdir", "/app"),
        shm_size=data.get("shm_size"),
        entrypoints=entrypoints,
        datasets=slots,
        metrics=metrics,
        raw=data,
    )
