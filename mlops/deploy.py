import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import sqlalchemy as sa

from . import db, models
from .config import load_config, resolve
from .project import ContractError, load_project
from .run import CONTAINER_MODEL_DIR, image_id, load_profile, render_command

LABEL = "mlops.project"


def container_name(project: str) -> str:
    return f"mlops-serve-{project}"


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["docker", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode:
        raise ContractError(r.stderr.strip() or f"docker {args[0]} failed")
    return r


def project_root(project: str) -> Path:
    with db.engine().connect() as conn:
        root = conn.execute(sa.select(db.projects.c.root).where(db.projects.c.name == project)).scalar()
    if root is None:
        raise ContractError(f"unknown project: {project}")
    return Path(root)


def _healthy(port: int | None) -> bool:
    if not port:
        return False
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics", timeout=1) as r:
            return r.status == 200
    except OSError:
        return False


def status(project: str) -> dict:
    r = docker("inspect", container_name(project), check=False)
    if r.returncode:
        return {"project": project, "running": False}
    info = json.loads(r.stdout)[0]
    labels = info["Config"]["Labels"]
    port = next((int(b[0]["HostPort"]) for b in (info["NetworkSettings"]["Ports"] or {}).values() if b), None)
    running = info["State"]["Running"]
    return {
        "project": project,
        "running": running,
        "state": info["State"]["Status"],
        "version": int(labels["mlops.version"]),
        "profile": labels.get("mlops.profile"),
        "started_at": info["State"]["StartedAt"],
        "port": port,
        "healthy": running and _healthy(port),
    }


def frame(port: int, view: str, width: int) -> bytes | None:
    query = urllib.parse.urlencode({"view": view, "width": width})
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/frame.jpg?{query}", timeout=3) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 503:
            raise ContractError("no frame processed yet")
        return None
    except OSError:
        return None


def logs(project: str, tail: int = 200) -> str:
    r = docker("logs", "--tail", str(tail), container_name(project), check=False)
    return (r.stdout + r.stderr) if r.returncode == 0 else ""


def write_targets() -> None:
    cfg = load_config()
    r = docker("ps", "--filter", f"label={LABEL}", "--format", "{{.Names}}", check=False)
    targets = []
    for name in r.stdout.split():
        info = json.loads(docker("inspect", name).stdout)[0]
        labels = info["Config"]["Labels"]
        ports = [b[0]["HostPort"] for b in (info["NetworkSettings"]["Ports"] or {}).values() if b]
        if ports:
            targets.append({"targets": [f"{cfg['prometheus_target_host']}:{ports[0]}"],
                            "labels": {"project": labels[LABEL], "version": labels["mlops.version"]}})
    folder = resolve(cfg["prometheus_targets_dir"])
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / "serve.json.tmp"
    tmp.write_text(json.dumps(targets, indent=2), encoding="utf-8")
    os.replace(tmp, folder / "serve.json")


def _event(project: str, action: str, version: int, previous: int | None = None, reason: str | None = None) -> None:
    with db.engine().begin() as conn:
        conn.execute(sa.insert(db.model_events).values(
            project=project, action=action, from_version=previous, to_version=version, reason=reason))


def start(project: str, version: int | None = None, profile_name: str | None = None) -> dict:
    cfg = load_config()
    spec = load_project(project_root(project))
    ep = spec.entrypoints.get("serve")
    if ep is None or not ep.port:
        raise ContractError(f"{project} has no serve entrypoint with a port")
    version = version or models.production_version(project)
    if version is None:
        raise ContractError(f"{project} has no production version")
    profile_name = profile_name or cfg["default_profile"]
    profile = load_profile(cfg, profile_name)
    image_id(spec.image)

    model_dir = resolve(cfg["runs_dir"]) / "serve" / project / f"v{version}"
    if model_dir.exists():
        shutil.rmtree(model_dir)
    model_path = models.download(project, version, model_dir)
    target = CONTAINER_MODEL_DIR + (f"/{model_path.name}" if model_path.is_file() else "")
    mount = model_path.parent if model_path.is_file() else model_path
    command = render_command(ep.command, {"model": target, "port": ep.port})

    previous = status(project)
    docker("rm", "-f", container_name(project), check=False)
    args = ["run", "-d", "--name", container_name(project), "--restart", "unless-stopped",
            "--label", f"{LABEL}={project}", "--label", f"mlops.version={version}",
            "--label", f"mlops.profile={profile_name}",
            "-p", f"127.0.0.1:{previous.get('port') or ''}:{ep.port}",
            "-v", f"{spec.root}:{spec.workdir}:ro", "-v", f"{mount}:{CONTAINER_MODEL_DIR}:ro",
            "-w", spec.workdir, "-e", f"MLOPS_PROFILE={profile_name}"]
    if profile.get("cpus"):
        args += ["--cpus", str(profile["cpus"])]
    if profile.get("memory"):
        args += ["--memory", str(profile["memory"])]
    args += ["--entrypoint", "sh", spec.image, "-c", command]
    docker(*args)
    write_targets()
    _event(project, "start", version, previous.get("version"))
    return status(project)


def stop(project: str) -> dict:
    current = status(project)
    if "version" not in current:
        raise ContractError(f"{project} is not deployed")
    docker("rm", "-f", container_name(project))
    write_targets()
    _event(project, "stop", current["version"])
    return status(project)


def follow_production(project: str) -> dict | None:
    current = status(project)
    production = models.production_version(project)
    if current.get("version") is None or production is None or current["version"] == production:
        return None
    return start(project, production, current.get("profile"))


def deployments() -> list[dict]:
    with db.engine().connect() as conn:
        names = conn.execute(sa.select(db.projects.c.name).order_by(db.projects.c.name)).scalars().all()
    out = []
    for name in names:
        spec = load_project(project_root(name))
        out.append({**status(name), "servable": "serve" in spec.entrypoints,
                    "production": models.production_version(name)})
    return out


QUERIES = {
    "latency_p50_ms": 'histogram_quantile(0.5, sum by (le) (rate(inference_latency_seconds_bucket{{project="{p}"}}[1m]))) * 1000',
    "latency_p95_ms": 'histogram_quantile(0.95, sum by (le) (rate(inference_latency_seconds_bucket{{project="{p}"}}[1m]))) * 1000',
    "requests_per_s": 'sum(rate(inference_requests_total{{project="{p}"}}[1m]))',
    "error_rate": 'sum(rate(inference_errors_total{{project="{p}"}}[1m])) / clamp_min(sum(rate(inference_requests_total{{project="{p}"}}[1m])), 1e-9)',
    "confidence_mean": 'sum(rate(prediction_confidence_sum{{project="{p}"}}[1m])) / clamp_min(sum(rate(prediction_confidence_count{{project="{p}"}}[1m])), 1e-9)',
    "predictions_per_input": 'sum(rate(predictions_per_input_sum{{project="{p}"}}[1m])) / clamp_min(sum(rate(predictions_per_input_count{{project="{p}"}}[1m])), 1e-9)',
}


STAGES = ('sum by (stage) (rate(stage_latency_seconds_sum{{project="{p}"}}[1m])) * 1000 '
          '/ clamp_min(sum by (stage) (rate(stage_latency_seconds_count{{project="{p}"}}[1m])), 1e-9)')


def _finite(points: list) -> list:
    return [p for p in points if p[1] == p[1] and abs(p[1]) != float("inf")]


def _prometheus(path: str, params: dict) -> dict:
    url = f"{load_config()['prometheus_url']}{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read())
    except OSError as e:
        raise ContractError(f"Prometheus is not reachable: {e}")


def live_metrics(project: str, minutes: int = 60, step: int = 15) -> dict:
    end = time.time()
    out = {}
    for key, query in QUERIES.items():
        data = _prometheus("/api/v1/query_range", {
            "query": query.format(p=project), "start": end - minutes * 60, "end": end, "step": step})
        result = data.get("data", {}).get("result", [])
        points = [[float(t), float(v)] for t, v in result[0]["values"]] if result else []
        out[key] = _finite(points)
    data = _prometheus("/api/v1/query_range", {
        "query": STAGES.format(p=project), "start": end - minutes * 60, "end": end, "step": step})
    out["stages_ms"] = {r["metric"].get("stage", "?"): _finite([[float(t), float(v)] for t, v in r["values"]])
                        for r in data.get("data", {}).get("result", [])}
    return out
