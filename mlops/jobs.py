import copy
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import sqlalchemy as sa
import yaml

from . import datasets, db, models
from .config import load_config, resolve
from .project import ContractError, load_project, split_key

ACTIVE = ("queued", "running", "cancelling")


def _now():
    return datetime.now(timezone.utc)


def job_dir(job_id: int) -> Path:
    return resolve(load_config()["runs_dir"]) / "jobs" / str(job_id)


def project_root(project: str) -> Path:
    with db.engine().connect() as conn:
        root = conn.execute(sa.select(db.projects.c.root).where(db.projects.c.name == project)).scalar()
    if root is None:
        raise ContractError(f"unknown project: {project}")
    return Path(root)


def merge(base: dict, overrides: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


def create(spec: dict, parent_id: int | None = None) -> int:
    project = load_project(project_root(spec["project"]))
    entrypoint = spec.get("entrypoint", "train")
    if entrypoint not in project.entrypoints:
        raise ContractError(f"{project.name} has no {entrypoint} entrypoint")
    key = project.model_key(spec.get("slot"))
    if entrypoint == "evaluate" and not spec.get("model"):
        raise ContractError("an evaluate job needs a model, for example project.model@v3")
    for ref in spec.get("datasets", []) + spec.get("eval_datasets", []):
        name, _ = datasets.parse_ref(ref)
        if name not in project.datasets:
            raise ContractError(f"dataset {name} is not declared by {project.name}")
        datasets.get_version(ref)
    base = spec.get("config") or project.entrypoints[entrypoint].config
    if spec.get("params") and not base:
        raise ContractError(f"{entrypoint} has no config to override")
    if base and not (project.root / base).is_file():
        raise ContractError(f"config not found: {base}")
    with db.engine().begin() as conn:
        return conn.execute(sa.insert(db.jobs).values(
            project=project.name, model=key, entrypoint=entrypoint, spec={**spec, "config": base},
            parent_id=parent_id)).inserted_primary_key[0]


def get(job_id: int) -> dict:
    with db.engine().connect() as conn:
        row = conn.execute(sa.select(db.jobs).where(db.jobs.c.id == job_id)).mappings().first()
    if row is None:
        raise ContractError(f"job not found: {job_id}")
    job = dict(row)
    with db.engine().connect() as conn:
        job["children"] = conn.execute(sa.select(db.jobs.c.id).where(db.jobs.c.parent_id == job_id)).scalars().all()
    return job


def list_jobs(model: str | None = None, limit: int = 50) -> list[dict]:
    query = sa.select(db.jobs).order_by(db.jobs.c.id.desc()).limit(limit)
    if model:
        query = query.where(db.jobs.c.model == model)
    with db.engine().connect() as conn:
        return [dict(r) for r in conn.execute(query).mappings()]


def cancel(job_id: int) -> dict:
    job = get(job_id)
    if job["status"] == "queued":
        _update(job_id, status="cancelled", finished_at=_now())
    elif job["status"] == "running":
        _update(job_id, status="cancelling")
    else:
        raise ContractError(f"job {job_id} is {job['status']}")
    return get(job_id)


def log(job_id: int, offset: int = 0, limit: int = 200_000) -> dict:
    path = job_dir(job_id) / "log.txt"
    if not path.exists():
        return {"text": "", "offset": 0}
    size = path.stat().st_size
    if offset < 0:
        offset = max(0, size - limit)
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read(limit)
    text = data.decode("utf-8", errors="replace")
    # progress bars redraw the same line with \r: keep only the last state of each line
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    text = "\n".join(line.split("\r")[-1] for line in text.replace("\r\n", "\n").split("\n"))
    return {"text": text, "offset": offset + len(data)}


def _update(job_id: int, **values) -> None:
    with db.engine().begin() as conn:
        conn.execute(sa.update(db.jobs).where(db.jobs.c.id == job_id).values(**values))


def _command(job: dict) -> list[str]:
    spec = job["spec"]
    root = project_root(job["project"])
    cmd = [sys.executable, "-m", "mlops.cli", "run", str(root), job["entrypoint"]]
    config = spec.get("config")
    if config and spec.get("params"):
        base = yaml.safe_load((root / config).read_text(encoding="utf-8")) or {}
        target = job_dir(job["id"]) / "config" / Path(config).name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(yaml.safe_dump(merge(base, spec["params"]), sort_keys=False), encoding="utf-8")
        cmd += ["--config", str(target)]
    elif config:
        cmd += ["--config", config]
    _, slot = split_key(job["model"])
    if slot:
        cmd += ["--slot", slot]
    for ref in spec.get("datasets", []):
        cmd += ["--dataset", ref]
    for flag in ("profile", "variant", "model"):
        if spec.get(flag):
            cmd += [f"--{flag}", str(spec[flag])]
    return cmd


def _parse(text: str) -> dict:
    out = {}
    if m := re.search(r"^run ([0-9a-f]{32}) ", text, re.M):
        out["run_id"] = m.group(1)
    if m := re.search(r"^registered (\S+)@v(\d+)", text, re.M):
        out["registered"] = {"model": m.group(1), "version": int(m.group(2))}
    if re.search(r"^evaluation of \S+ recorded", text, re.M):
        out["evaluated"] = True
    return out


def _run(job: dict) -> None:
    folder = job_dir(job["id"])
    folder.mkdir(parents=True, exist_ok=True)
    log_path = folder / "log.txt"
    try:
        cmd = _command(job)
    except Exception as e:
        _update(job["id"], status="failed", error=str(e), finished_at=_now())
        return
    _update(job["id"], status="running", started_at=_now())
    with open(log_path, "wb") as log_file:
        proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT, cwd=str(resolve(".")),
                                env={**_env(), "PYTHONUNBUFFERED": "1"})
        cancelled = False
        while proc.poll() is None:
            time.sleep(2)
            if get(job["id"])["status"] == "cancelling":
                cancelled = True
                _kill(proc, log_path)
    info = _parse(log_path.read_text(encoding="utf-8", errors="replace"))
    if cancelled:
        _update(job["id"], status="cancelled", run_id=info.get("run_id"), result=info, finished_at=_now())
        return
    ok = proc.returncode == 0
    _update(job["id"], status="finished" if ok else "failed", run_id=info.get("run_id"), result=info,
            error=None if ok else f"exit code {proc.returncode}", finished_at=_now())
    spec = job["spec"]
    if ok and job["entrypoint"] == "train" and spec.get("auto_evaluate") and info.get("registered"):
        reg = info["registered"]
        create({"project": job["project"], "slot": split_key(job["model"])[1], "entrypoint": "evaluate",
                "model": f"{reg['model']}@v{reg['version']}", "datasets": spec.get("eval_datasets", []),
                "profile": spec.get("profile")}, parent_id=job["id"])


def _kill(proc: subprocess.Popen, log_path: Path) -> None:
    info = _parse(log_path.read_text(encoding="utf-8", errors="replace"))
    proc.terminate()
    if info.get("run_id"):
        subprocess.run(["docker", "rm", "-f", f"mlops-{info['run_id'][:12]}"], capture_output=True)
        try:
            models.client().set_terminated(info["run_id"], "KILLED")
        except Exception:
            pass


def _env() -> dict:
    return {**os.environ, "MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT": "1"}


def work(poll: float = 2.0) -> None:
    with db.engine().begin() as conn:
        conn.execute(sa.update(db.jobs).where(db.jobs.c.status.in_(("running", "cancelling")))
                     .values(status="failed", error="worker restarted", finished_at=_now()))
    print("worker ready", flush=True)
    while True:
        with db.engine().connect() as conn:
            row = conn.execute(sa.select(db.jobs).where(db.jobs.c.status == "queued")
                               .order_by(db.jobs.c.id).limit(1)).mappings().first()
        if row is None:
            time.sleep(poll)
            continue
        job = dict(row)
        print(f"job {job['id']}: {job['model']} {job['entrypoint']}", flush=True)
        _run(job)
        print(f"job {job['id']}: {get(job['id'])['status']}", flush=True)
