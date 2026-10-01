import json
import re
from pathlib import Path

import mlflow
import sqlalchemy as sa
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

from . import db
from .config import load_config
from .datasets import ref_of
from .project import ContractError, split_key

REF_RE = re.compile(r"^([a-z0-9][a-z0-9_\-]*(?:\.[a-z0-9][a-z0-9_\-]*)?)@(v?\d+|[a-z]+)$")
CANDIDATE, PRODUCTION = "candidate", "production"


def client() -> MlflowClient:
    return MlflowClient(load_config()["tracking_uri"])


def is_ref(value: str) -> bool:
    return bool(REF_RE.match(value))


def resolve(ref: str) -> tuple[str, int]:
    match = REF_RE.match(ref)
    if not match:
        raise ContractError(f"invalid model reference: {ref} (expected project[.model]@vN or @alias)")
    name, target = match.groups()
    if target.lstrip("v").isdigit():
        return name, int(target.lstrip("v"))
    try:
        return name, int(client().get_model_version_by_alias(name, target).version)
    except MlflowException:
        raise ContractError(f"no model version with alias {target} for {name}")


def register(project: str, run_id: str, variant: str | None = None, parent: int | None = None) -> int:
    c = client()
    try:
        c.create_registered_model(project)
    except MlflowException as e:
        if e.error_code != "RESOURCE_ALREADY_EXISTS":
            raise
    source = f"{c.get_run(run_id).info.artifact_uri}/model"
    version = int(c.create_model_version(project, source, run_id=run_id).version)
    c.set_model_version_tag(project, str(version), "status", CANDIDATE)
    if variant:
        c.set_model_version_tag(project, str(version), "variant", variant)
    if parent:
        c.set_model_version_tag(project, str(version), "parent", f"v{parent}")
    c.set_registered_model_alias(project, CANDIDATE, str(version))
    return version


def download(project: str, version: int, dst: Path) -> Path:
    source = client().get_model_version(project, str(version)).source
    path = Path(mlflow.artifacts.download_artifacts(artifact_uri=source, dst_path=str(dst),
                                                   tracking_uri=load_config()["tracking_uri"]))
    files = [p for p in path.rglob("*") if p.is_file()]
    return files[0] if len(files) == 1 else path


def record_evaluation(project: str, version: int, run_id: str, dataset_version_ids: list[int],
                      metrics: dict[str, float], confusion: dict | None = None, extras: dict | None = None) -> None:
    with db.engine().begin() as conn:
        for dv in dataset_version_ids:
            conn.execute(sa.insert(db.model_evaluations).values(
                project=project, model_version=version, run_id=run_id, dataset_version_id=dv, metrics=metrics,
                confusion=confusion, extras=extras))


CONSTRAINTS = {
    "latency_p50_ms": ("latency_ms.p50", "max"),
    "latency_p95_ms": ("latency_ms.p95", "max"),
    "latency_p99_ms": ("latency_ms.p99", "max"),
    "end_to_end_p95_ms": ("end_to_end_ms.p95", "max"),
    "cold_start_ms": ("cold_start_ms", "max"),
    "ram_mb": ("ram_peak_mb", "max"),
    "model_mb": ("model_mb", "max"),
    "fps": ("fps", "min"),
}


def record_benchmark(project: str, version: int, run_id: str, profile: str, metrics: dict, measured: bool) -> None:
    with db.engine().begin() as conn:
        conn.execute(sa.insert(db.model_benchmarks).values(
            project=project, model_version=version, run_id=run_id, profile=profile, metrics=metrics, measured=measured))


def benchmarks(project: str, version: int) -> dict[str, dict]:
    b = db.model_benchmarks
    query = sa.select(b).where(b.c.project == project, b.c.model_version == version).order_by(b.c.id)
    with db.engine().connect() as conn:
        return {r["profile"]: {**r["metrics"], "_measured": r["measured"], "_run_id": r["run_id"],
                               "_at": r["created_at"].isoformat()} for r in conn.execute(query).mappings()}


def constraint_checks(contract: dict, project: str, version: int) -> list[dict]:
    out = []
    for profile, limits in (contract.get("constraints") or {}).items():
        bench = benchmarks(project, version).get(profile)
        for name, limit in limits.items():
            key, kind = CONSTRAINTS.get(name, (name, "max"))
            label = f"{profile}: {key}"
            if bench is None or key not in bench:
                out.append({"metric": label, "new": None, "current": limit, "ok": False,
                            "rule": f"not benchmarked on {profile}"})
                continue
            value = bench[key]
            ok = value <= limit if kind == "max" else value >= limit
            out.append({"metric": label, "new": value, "current": limit, "ok": ok,
                        "rule": f"must be {'at most' if kind == 'max' else 'at least'} {limit:g} on {profile}"
                                + (" (estimated)" if not bench["_measured"] else "")})
    return out


def confusion_matrices(project: str, version: int) -> dict[int, dict]:
    return _latest_column(project, version, "confusion")


def evaluation_extras(project: str, version: int) -> dict[int, dict]:
    return _latest_column(project, version, "extras")


def _latest_column(project: str, version: int, column: str) -> dict[int, dict]:
    e = db.model_evaluations
    query = (sa.select(e.c.dataset_version_id, e.c[column])
             .where(e.c.project == project, e.c.model_version == version).order_by(e.c.id))
    with db.engine().connect() as conn:
        return {dv: value for dv, value in conn.execute(query) if value}


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
            "variant": mv.tags.get("variant"),
            "parent": mv.tags.get("parent"),
            "description": mv.description or None,
            "aliases": aliases.get(version, []),
            "run_id": mv.run_id,
            "trained_on": train_datasets(mv.run_id),
            "evaluations": {ref_of(dv): m for dv, m in evaluations(project, version).items()},
            "confusion": {ref_of(dv): cm for dv, cm in confusion_matrices(project, version).items()},
            "extras": {ref_of(dv): x for dv, x in evaluation_extras(project, version).items()},
            "benchmarks": benchmarks(project, version),
        })
    return out


def _contract(key: str) -> dict:
    project, slot = split_key(key)
    with db.engine().connect() as conn:
        row = conn.execute(sa.select(db.projects.c.contract).where(db.projects.c.name == project)).first()
    if row is None:
        raise ContractError(f"unknown project: {project} (run it once first)")
    contract = row[0]
    if slot:
        spec = (contract.get("models") or {}).get(slot) or {}
        contract = {**contract, "metrics": {**contract["metrics"], **(spec.get("metrics") or {})}}
    return contract


def promotion_checks(project: str, version: int, dataset_version_id: int | None = None) -> dict:
    """Compare a version with production under the project promotion rule. Raises if it can't be compared."""
    contract = _contract(project)
    metrics = contract["metrics"]
    rule = contract.get("promotion") or {}
    primary, higher = metrics["primary"], bool(metrics["higher_is_better"])
    new = evaluations(project, version)
    if not new:
        raise ContractError(f"v{version} has no evaluation, run evaluate with --model {project}@v{version}")
    current = production_version(project)
    limits = constraint_checks(contract, project, version)
    if current is None:
        failed = [c for c in limits if not c["ok"]]
        return {"allowed": not failed, "checks": limits,
                "detail": "first production version" if not failed else "refused: " + "; ".join(
                    f"{c['metric']} {c['rule']}" for c in failed)}
    cur = evaluations(project, current)
    common = set(new) & set(cur)
    if dataset_version_id is not None:
        common &= {dataset_version_id}
    if not common:
        raise ContractError(f"v{version} and v{current} have no evaluation on the same dataset version")
    dv = max(common)
    if primary not in new[dv] or primary not in cur[dv]:
        raise ContractError(f"metric {primary} missing from the evaluations on {ref_of(dv)}")

    checks = []
    a, b = new[dv][primary], cur[dv][primary]
    gain = (a - b) if higher else (b - a)
    min_gain = float(rule.get("min_gain", 0))
    checks.append({
        "metric": primary, "new": a, "current": b,
        "ok": gain > min_gain if min_gain == 0 else gain >= min_gain,
        "rule": f"must be {'higher' if higher else 'lower'}" + (f" by at least {min_gain:g}" if min_gain else ""),
    })
    tolerance = float(rule.get("tolerance", 0.02))
    guarded = rule.get("no_regression") or {}
    if isinstance(guarded, list):
        guarded = {k: "higher" for k in guarded}
    for key, direction in guarded.items():
        if key not in new[dv] or key not in cur[dv]:
            checks.append({"metric": key, "new": new[dv].get(key), "current": cur[dv].get(key), "ok": True,
                           "rule": "not measured on both versions, skipped"})
            continue
        x, y = new[dv][key], cur[dv][key]
        margin = tolerance * abs(y)
        ok = x >= y - margin if direction == "higher" else x <= y + margin
        checks.append({"metric": key, "new": x, "current": y, "ok": ok,
                       "rule": f"must not {'drop' if direction == 'higher' else 'rise'} more than {tolerance:.0%}"})
    checks += limits
    allowed = all(c["ok"] for c in checks)
    failed = [c for c in checks if not c["ok"]]
    head = f"{primary} {a:g} vs {b:g} (v{current}) on {ref_of(dv)}"
    detail = head if allowed else f"refused on {ref_of(dv)} against v{current}: " + "; ".join(
        f"{c['metric']} {c['rule']}" if c["new"] is None else f"{c['metric']} {c['new']:g} vs {c['current']:g}, {c['rule']}"
        for c in failed)
    return {"allowed": allowed, "detail": detail, "checks": checks, "dataset": ref_of(dv), "current": current}


def check_promotion(project: str, version: int, dataset_version_id: int | None = None) -> str:
    result = promotion_checks(project, version, dataset_version_id)
    if not result["allowed"]:
        raise ContractError(result["detail"])
    return result["detail"]


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


def model_keys(contract: dict) -> list[tuple[str, str | None]]:
    slots = list((contract.get("models") or {}))
    return [(f"{contract['name']}.{s}", s) for s in slots] if slots else [(contract["name"], None)]


def list_projects() -> list[dict]:
    c = client()
    with db.engine().connect() as conn:
        rows = [dict(r) for r in conn.execute(sa.select(db.projects).order_by(db.projects.c.name)).mappings()]
    registered = {m.name: m for m in c.search_registered_models()}
    out = []
    for row in rows:
        for key, slot in model_keys(row["contract"]):
            model = registered.get(key)
            contract = _contract(key)
            spec = (contract.get("models") or {}).get(slot) or {} if slot else {}
            out.append({
                "name": key,
                "project": row["name"],
                "slot": slot,
                "description": spec.get("description"),
                "task": contract.get("task"),
                "primary": contract["metrics"]["primary"],
                "higher_is_better": contract["metrics"]["higher_is_better"],
                "watch": contract["metrics"].get("watch", []),
                "descriptions": contract["metrics"].get("descriptions", {}),
                "constraints": contract.get("constraints") or {},
                "retrain": [r for r in contract.get("retrain") or [] if r.get("model") == slot],
                "versions": len(c.search_model_versions(f"name='{key}'")) if model else 0,
                "production": int(model.aliases["production"]) if model and "production" in model.aliases else None,
                "updated_at": row["updated_at"],
            })
    return out


def metric_history(run_id: str) -> dict[str, list[list[float]]]:
    c = client()
    keys = c.get_run(run_id).data.metrics.keys()
    out = {}
    for key in keys:
        points = sorted((m.step, m.value) for m in c.get_metric_history(run_id, key))
        if len(points) > 1:
            out[key] = [[float(s), float(v)] for s, v in points]
    return out


def rename(old: str, new: str) -> None:
    client().rename_registered_model(old, new)
    with db.engine().begin() as conn:
        for table in (db.model_evaluations, db.model_events):
            conn.execute(sa.update(table).where(table.c.project == old).values(project=new))


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


def import_model(key: str, path: Path, dataset_version_ids: list[int], metrics_file: Path | None = None,
                 note: str | None = None, variant: str | None = None) -> int:
    if not path.exists():
        raise ContractError(f"model not found: {path}")
    project, _ = split_key(key)
    mlflow.set_tracking_uri(load_config()["tracking_uri"])
    mlflow.set_experiment(project)
    with mlflow.start_run(run_name="import") as run:
        mlflow.set_tags({"imported": "true", "source_path": str(path), "mlops.model": key})
        mlflow.log_params({"entrypoint": "import", **({"note": note} if note else {})})
        if path.is_dir():
            mlflow.log_artifacts(str(path), "model")
        else:
            mlflow.log_artifact(str(path), "model")
        if metrics_file:
            from .run import flatten_metrics

            data = json.loads(metrics_file.read_text(encoding="utf-8"))
            mlflow.log_metrics(flatten_metrics(data))
            mlflow.log_artifact(str(metrics_file), "metrics")
        run_id = run.info.run_id
    with db.engine().begin() as conn:
        for dv in dataset_version_ids:
            conn.execute(sa.insert(db.run_datasets).values(
                run_id=run_id, project=project, entrypoint="import", dataset_version_id=dv, mount=""))
    version = register(key, run_id, variant)
    if note:
        client().update_model_version(key, str(version), description=note)
    return version
