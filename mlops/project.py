import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

REQUIRED_ENTRYPOINTS = ("train", "evaluate")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")


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
class ModelSlot:
    name: str
    description: str | None = None
    vars: dict[str, str] = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    image: str | None = None


@dataclass
class Project:
    root: Path
    name: str
    image: str
    workdir: str
    shm_size: str | None
    entrypoints: dict[str, Entrypoint]
    datasets: dict[str, DatasetSlot]
    models: dict[str, ModelSlot]
    metrics: dict
    raw: dict
    preprocessing: list[str] = field(default_factory=list)

    def model_key(self, slot: str | None) -> str:
        if not self.models:
            if slot:
                raise ContractError(f"{self.name} declares no models, drop --slot")
            return self.name
        if slot is None:
            raise ContractError(f"{self.name} has several models, pass --slot ({', '.join(self.models)})")
        if slot not in self.models:
            raise ContractError(f"unknown model {slot} (declared: {', '.join(self.models)})")
        return f"{self.name}.{slot}"

    def slot_vars(self, slot: str | None) -> dict[str, str]:
        return dict(self.models[slot].vars) if slot else {}

    def image_for(self, slot: str | None) -> str:
        return (self.models[slot].image if slot else None) or self.image

    def slot_metrics(self, slot: str | None) -> dict:
        return {**self.metrics, **(self.models[slot].metrics if slot else {})}


def split_key(key: str) -> tuple[str, str | None]:
    project, _, slot = key.partition(".")
    return project, slot or None


def load_project(root: str | Path) -> Project:
    root = Path(root).resolve()
    path = root / "project.yaml"
    if not path.is_file():
        raise ContractError(f"{path} not found")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    for key in ("name", "image", "entrypoints", "metrics"):
        if key not in data:
            raise ContractError(f"missing field: {key}")
    if not NAME_RE.match(str(data["name"])):
        raise ContractError("name: lowercase letters, digits, - and _ only")

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

    models = {}
    for name, spec in (data.get("models") or {}).items():
        spec = spec or {}
        if not NAME_RE.match(str(name)):
            raise ContractError(f"models.{name}: lowercase letters, digits, - and _ only")
        models[name] = ModelSlot(name, spec.get("description"), {k: str(v) for k, v in (spec.get("vars") or {}).items()},
                                 spec.get("metrics") or {}, spec.get("image"))

    metrics = data["metrics"] or {}
    for key in ("primary", "higher_is_better"):
        if key not in metrics:
            raise ContractError(f"missing field: metrics.{key}")

    preprocessing = list(data.get("preprocessing") or [])
    for rel in preprocessing:
        if not (root / rel).is_file():
            raise ContractError(f"preprocessing file not found: {rel}")

    return Project(
        preprocessing=preprocessing,
        root=root,
        name=data["name"],
        image=data["image"],
        workdir=data.get("workdir", "/app"),
        shm_size=data.get("shm_size"),
        entrypoints=entrypoints,
        datasets=slots,
        models=models,
        metrics=metrics,
        raw=data,
    )
