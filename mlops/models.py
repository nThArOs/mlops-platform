import re
from pathlib import Path

import mlflow
import sqlalchemy as sa
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

from . import db
from .config import load_config
from .datasets import ref_of
from .project import ContractError

REF_RE = re.compile(r"^([a-z0-9][a-z0-9_\-]*)@(v?\d+|[a-z]+)$")
CANDIDATE, PRODUCTION = "candidate", "production"


def client() -> MlflowClient:
    return MlflowClient(load_config()["tracking_uri"])


def is_ref(value: str) -> bool:
    return bool(REF_RE.match(value))


def resolve(ref: str) -> tuple[str, int]:
    match = REF_RE.match(ref)
    if not match:
        raise ContractError(f"invalid model reference: {ref} (expected project@vN or project@alias)")
    name, target = match.groups()
    if target.lstrip("v").isdigit():
        return name, int(target.lstrip("v"))
    try:
        return name, int(client().get_model_version_by_alias(name, target).version)
    except MlflowException:
        raise ContractError(f"no model version with alias {target} for {name}")


def register(project: str, run_id: str) -> int:
    c = client()
    try:
        c.create_registered_model(project)
    except MlflowException as e:
        if e.error_code != "RESOURCE_ALREADY_EXISTS":
            raise
    source = f"{c.get_run(run_id).info.artifact_uri}/model"
    version = int(c.create_model_version(project, source, run_id=run_id).version)
    c.set_model_version_tag(project, str(version), "status", CANDIDATE)
    c.set_registered_model_alias(project, CANDIDATE, str(version))
    return version


def download(project: str, version: int, dst: Path) -> Path:
    source = client().get_model_version(project, str(version)).source
    path = Path(mlflow.artifacts.download_artifacts(artifact_uri=source, dst_path=str(dst)))
    files = [p for p in path.rglob("*") if p.is_file()]
    return files[0] if len(files) == 1 else path


def record_evaluation(project: str, version: int, run_id: str, dataset_version_ids: list[int],
                      metrics: dict[str, float]) -> None:
    with db.engine().begin() as conn:
        for dv in dataset_version_ids:
            conn.execute(sa.insert(db.model_evaluations).values(
                project=project, model_version=version, run_id=run_id, dataset_version_id=dv, metrics=metrics))


def evaluations(project: str, version: int) -> dict[int, dict]:
    """Latest metrics per dataset version id."""
    e = db.model_evaluations
    query = sa.select(e).where(e.c.project == project, e.c.model_version == version).order_by(e.c.id)
    with db.engine().connect() as conn:
        return {r["dataset_version_id"]: r["metrics"] for r in conn.execute(query).mappings()}


def production_version(project: str) -> int | None:
    try:
        return int(client().get_model_version_by_alias(project, PRODUCTION).version)
    except MlflowException:
        return None


def train_datasets(run_id: str) -> list[str]:
    rd = db.run_datasets
    with db.engine().connect() as conn:
        ids = conn.execute(sa.select(rd.c.dataset_version_id).where(rd.c.run_id == run_id)).scalars().all()
    return [ref_of(i) for i in ids]


def list_versions(project: str) -> list[dict]:
    c = client()
    try:
        aliases = {}
        for alias, version in c.get_registered_model(project).aliases.items():
            aliases.setdefault(int(version), []).append(alias)
    except MlflowException:
        raise ContractError(f"no registered model for {project}")
    out = []
    for mv in sorted(c.search_model_versions(f"name='{project}'"), key=lambda m: int(m.version)):
        version = int(mv.version)
        out.append({
            "version": version,
            "status": mv.tags.get("status", ""),
            "aliases": aliases.get(version, []),
            "run_id": mv.run_id,
            "trained_on": train_datasets(mv.run_id),
            "evaluations": {ref_of(dv): m for dv, m in evaluations(project, version).items()},
        })
    return out


def _contract(project: str) -> dict:
    with db.engine().connect() as conn:
        row = conn.execute(sa.select(db.projects.c.contract).where(db.projects.c.name == project)).first()
    if row is None:
        raise ContractError(f"unknown project: {project} (run it once first)")
    return row[0]


def check_promotion(project: str, version: int, dataset_version_id: int | None = None) -> str:
    """Return a description of the comparison, raise ContractError if the version is not better."""
    metrics = _contract(project)["metrics"]
    primary, higher = metrics["primary"], bool(metrics["higher_is_better"])
    new = evaluations(project, version)
    if not new:
        raise ContractError(f"v{version} has no evaluation, run evaluate with --model {project}@v{version}")
    current = production_version(project)
    if current is None:
        return f"first production version, no comparison"
    cur = evaluations(project, current)
    common = set(new) & set(cur)
    if dataset_version_id is not None:
        common &= {dataset_version_id}
    if not common:
        raise ContractError(f"v{version} and v{current} have no evaluation on the same dataset version")
    dv = max(common)
    if primary not in new[dv] or primary not in cur[dv]:
        raise ContractError(f"metric {primary} missing from the evaluations on {ref_of(dv)}")
    a, b = new[dv][primary], cur[dv][primary]
    better = a > b if higher else a < b
    detail = f"{primary} {a:g} vs {b:g} (v{current}) on {ref_of(dv)}"
    if not better:
        raise ContractError(f"refused: {detail}, not better")
    return detail


def _set_production(project: str, version: int, action: str, reason: str | None, forced: bool) -> int | None:
    c = client()
    current = production_version(project)
    if current == version:
        raise ContractError(f"v{version} is already in production")
    c.set_registered_model_alias(project, PRODUCTION, str(version))
    c.set_model_version_tag(project, str(version), "status", PRODUCTION)
    if current is not None:
        c.set_model_version_tag(project, str(current), "status", "archived")
    try:
        if int(c.get_model_version_by_alias(project, CANDIDATE).version) == version:
            c.delete_registered_model_alias(project, CANDIDATE)
    except MlflowException:
        pass
    with db.engine().begin() as conn:
        conn.execute(sa.insert(db.model_events).values(
            project=project, action=action, from_version=current, to_version=version, reason=reason, forced=forced))
    return current


def promote(project: str, version: int, dataset_version_id: int | None = None, force: bool = False,
            reason: str | None = None) -> str:
    if force:
        if not reason:
            raise ContractError("--force needs --reason")
        detail = "forced"
    else:
        detail = check_promotion(project, version, dataset_version_id)
    _set_production(project, version, "promote", reason or detail, force)
    return detail


def rollback(project: str, reason: str | None = None) -> int:
    current = production_version(project)
    if current is None:
        raise ContractError(f"no production version for {project}")
    ev = db.model_events
    with db.engine().connect() as conn:
        row = conn.execute(
            sa.select(ev.c.from_version).where(ev.c.project == project, ev.c.to_version == current,
                                               ev.c.from_version.is_not(None)).order_by(ev.c.id.desc()).limit(1)
        ).first()
    if row is None:
        raise ContractError(f"no previous production version for {project}")
    _set_production(project, row[0], "rollback", reason or "rollback", False)
    return row[0]


def history(project: str) -> list[dict]:
    ev = db.model_events
    with db.engine().connect() as conn:
        return [dict(r) for r in conn.execute(sa.select(ev).where(ev.c.project == project).order_by(ev.c.id)).mappings()]


def list_projects() -> list[dict]:
    c = client()
    with db.engine().connect() as conn:
        rows = [dict(r) for r in conn.execute(sa.select(db.projects).order_by(db.projects.c.name)).mappings()]
    registered = {m.name: m for m in c.search_registered_models()}
    out = []
    for row in rows:
        model = registered.get(row["name"])
        contract = row["contract"]
        out.append({
            "name": row["name"],
            "task": contract.get("task"),
            "primary": contract["metrics"]["primary"],
            "higher_is_better": contract["metrics"]["higher_is_better"],
            "versions": len(c.search_model_versions(f"name='{row['name']}'")) if model else 0,
            "production": int(model.aliases["production"]) if model and "production" in model.aliases else None,
            "updated_at": row["updated_at"],
        })
    return out


def production_dataset_ids() -> set[int]:
    c = client()
    ids = set()
    rd = db.run_datasets
    for model in c.search_registered_models():
        if PRODUCTION not in model.aliases:
            continue
        run_id = c.get_model_version(model.name, model.aliases[PRODUCTION]).run_id
        with db.engine().connect() as conn:
            ids |= set(conn.execute(sa.select(rd.c.dataset_version_id).where(rd.c.run_id == run_id)).scalars())
    return ids
