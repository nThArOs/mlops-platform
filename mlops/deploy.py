import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from . import cpus, db, models, preprocessing
from .config import load_config, resolve
from .paths import to_host, to_local
from .project import ContractError, load_project, split_key
from .run import CONTAINER_MODEL_DIR, image_id, load_profile, render_command

LABEL = "mlops.project"


def free_port(wanted: int = 0) -> int | None:
    # an explicit host port survives container restarts, an ephemeral one changes and loses Prometheus
    import random
    import socket

    host = load_config()["service_host"]
    if host == "127.0.0.1":
        with socket.socket() as s:
            try:
                s.bind((host, wanted))
            except OSError:
                return None
            return s.getsockname()[1]
    # in a container the host's ports can't be bound, only probed
    for port in [wanted] if wanted else random.sample(range(20000, 60000), 20):
        with socket.socket() as s:
            s.settimeout(0.3)
            if s.connect_ex((host, port)) != 0:
                return port
    return None


def host_port(service_dir: Path, current: int | None) -> int:
    """Keep the port a service had, across restarts and stop/start, unless something else took it."""
    saved = service_dir / "port"
    known = int(saved.read_text()) if saved.is_file() else None
    port = next((p for p in (current, known) if p and free_port(p)), None) or free_port()
    service_dir.mkdir(parents=True, exist_ok=True)
    saved.write_text(str(port))
    return port


def container_name(key: str) -> str:
    return "mlops-serve-" + key.replace(".", "-")


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["docker", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode:
        raise ContractError(r.stderr.strip() or f"docker {args[0]} failed")
    return r


def project_root(key: str) -> Path:
    project, _ = split_key(key)
    with db.engine().connect() as conn:
        root = conn.execute(sa.select(db.projects.c.root).where(db.projects.c.name == project)).scalar()
    if root is None:
        raise ContractError(f"unknown project: {project}")
    return to_local(root)


def _healthy(port: int | None) -> bool:
    if not port:
        return False
    try:
        with urllib.request.urlopen(f"http://{load_config()['service_host']}:{port}/metrics", timeout=1) as r:
            return r.status == 200
    except OSError:
        return False


def status(project: str) -> dict:
    want = desired(project)
    wanted = {"desired": {k: want[k] for k in ("version", "profile", "state", "error")}} if want else {}
    r = docker("inspect", container_name(project), check=False)
    if r.returncode:
        return {"project": project, "running": False, **wanted}
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
        **wanted,
    }


def frame(port: int, view: str, width: int) -> bytes | None:
    query = urllib.parse.urlencode({"view": view, "width": width})
    try:
        with urllib.request.urlopen(f"http://{load_config()['service_host']}:{port}/frame.jpg?{query}", timeout=3) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 503:
            raise ContractError("no frame processed yet")
        return None
    except OSError:
        return None


UNITS = {"B": 1 / 2**20, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "TiB": 2**20, "kB": 1e3 / 2**20, "MB": 1e6 / 2**20, "GB": 1e9 / 2**20}


def _mib(text: str) -> float:
    m = re.match(r"([\d.]+)\s*([A-Za-z]+)", text.strip())
    return float(m.group(1)) * UNITS.get(m.group(2), 1) if m else 0.0


def resources(project: str) -> dict | None:
    r = docker("stats", "--no-stream", "--format", "{{json .}}", container_name(project), check=False)
    if r.returncode or not r.stdout.strip():
        return None
    s = json.loads(r.stdout.strip().splitlines()[0])
    used, limit = (part.strip() for part in s["MemUsage"].split("/"))
    return {"cpu_pct": float(s["CPUPerc"].rstrip("%") or 0), "mem_mb": round(_mib(used), 1),
            "mem_limit_mb": round(_mib(limit), 1), "pids": int(s.get("PIDs") or 0)}


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


def _serve_spec(project: str):
    spec = load_project(project_root(project))
    _, slot = split_key(project)
    if spec.model_key(slot) != project:
        raise ContractError(f"unknown model: {project}")
    ep = spec.entrypoints.get("serve")
    if ep is None or not ep.port:
        raise ContractError(f"{project} has no serve entrypoint with a port")
    return spec, slot, ep


def _run_service(project: str, version: int, profile_name: str) -> None:
    """Replace the service container with one running this version; only the reconcile loop calls it."""
    cfg = load_config()
    spec, slot, ep = _serve_spec(project)
    profile = load_profile(cfg, profile_name)
    image = spec.image_for(slot)
    image_id(image)

    service_dir = resolve(cfg["runs_dir"]) / "serve" / project.replace(".", "-")
    model_dir = service_dir / f"v{version}"
    if model_dir.exists():
        shutil.rmtree(model_dir)
    model_path = models.download(project, version, model_dir)
    target = CONTAINER_MODEL_DIR + (f"/{model_path.name}" if model_path.is_file() else "")
    mount = model_path.parent if model_path.is_file() else model_path
    command = render_command(ep.command, {**spec.slot_vars(slot), "model": target, "port": ep.port})

    previous = status(project)
    docker("rm", "-f", container_name(project), check=False)
    port = host_port(service_dir, previous.get("port"))
    cpuset = cpus.pin(cfg, "services", profile.get("cpus"))
    args = ["run", "-d", "--name", container_name(project), "--restart", "unless-stopped",
            "--label", f"{LABEL}={project}", "--label", f"mlops.version={version}",
            "--label", f"mlops.profile={profile_name}",
            "-p", f"127.0.0.1:{port}:{ep.port}",
            "-v", f"{to_host(spec.root)}:{spec.workdir}:ro", "-v", f"{to_host(mount)}:{CONTAINER_MODEL_DIR}:ro",
            "-w", spec.workdir, "-e", f"MLOPS_PROFILE={profile_name}"]
    if profile.get("cpus"):
        args += ["--cpus", str(profile["cpus"])]
    if cpuset:
        args += ["--cpuset-cpus", cpuset, "--label", f"mlops.cpuset={cpuset}"]
    if profile.get("memory"):
        args += ["--memory", str(profile["memory"])]
    if spec.preprocessing:
        pinned = models.preprocessing_snapshot(project, version, service_dir / f"v{version}-preprocessing")
        args += preprocessing.mounts(pinned, spec.preprocessing, spec.workdir)
    args += ["--entrypoint", "sh", image, "-c", command]
    docker(*args)
    write_targets()


def desired(project: str) -> dict | None:
    with db.engine().connect() as conn:
        row = conn.execute(sa.select(db.deployments).where(db.deployments.c.project == project)).mappings().first()
    return dict(row) if row else None


def _want(project: str, **values) -> None:
    d = db.deployments
    stmt = pg_insert(d).values(project=project, **values)
    stmt = stmt.on_conflict_do_update(index_elements=["project"],
                                      set_={**values, "error": None, "updated_at": sa.func.now()})
    with db.engine().begin() as conn:
        conn.execute(stmt)


def start(project: str, version: int | None = None, profile_name: str | None = None) -> dict:
    """Ask for this version to be served; the worker's reconcile loop starts or replaces the container."""
    _serve_spec(project)
    version = version or models.production_version(project)
    if version is None:
        raise ContractError(f"{project} has no production version")
    previous = desired(project) or {}
    profile_name = profile_name or previous.get("profile") or load_config()["default_profile"]
    load_profile(load_config(), profile_name)
    _want(project, version=version, profile=profile_name, state="running")
    _event(project, "start", version, previous.get("version"))
    return status(project)


def stop(project: str) -> dict:
    current = desired(project)
    if not current or current["state"] != "running":
        raise ContractError(f"{project} is not deployed")
    _want(project, version=current["version"], profile=current["profile"], state="stopped")
    _event(project, "stop", current["version"])
    return status(project)


def follow_production(project: str) -> dict | None:
    current = desired(project)
    production = models.production_version(project)
    if not current or current["state"] != "running" or production is None or current["version"] == production:
        return None
    return start(project, production, current["profile"])


def reconcile(only: str | None = None) -> list[str]:
    """Make Docker match the desired state: start, replace or remove service containers."""
    actions = []
    for name in _labelled() if only is None else []:
        if desired(name) is None:  # started before desired state existed: adopt it as is
            st = status(name)
            if st.get("version"):
                _want(name, version=st["version"], profile=st.get("profile") or load_config()["default_profile"],
                      state="running" if st["running"] else "stopped")
    with db.engine().connect() as conn:
        rows = conn.execute(sa.select(db.deployments)).mappings().all()
    for row in rows:
        project = row["project"]
        if only and project != only:
            continue
        st = status(project)
        try:
            if row["state"] == "running" and (not st["running"] or st.get("version") != row["version"]
                                              or st.get("profile") != row["profile"]):
                _run_service(project, row["version"], row["profile"])
                actions.append(f"{project}: v{row['version']} on {row['profile']}")
            elif row["state"] == "stopped" and "version" in st:
                docker("rm", "-f", container_name(project))
                write_targets()
                actions.append(f"{project}: stopped")
            elif row["error"] is None:
                continue
            _error(project, None)
        except Exception as e:  # kept on the row and shown in the UI, retried on the next pass
            _error(project, str(e))
            actions.append(f"{project}: {e}")
    return actions


def _error(project: str, error: str | None) -> None:
    with db.engine().begin() as conn:
        conn.execute(sa.update(db.deployments).where(db.deployments.c.project == project).values(error=error))


def _labelled() -> list[str]:
    r = docker("ps", "-a", "--filter", f"label={LABEL}", "--format", f'{{{{.Label "{LABEL}"}}}}', check=False)
    return [n for n in r.stdout.split() if n]


def deployments() -> list[dict]:
    with db.engine().connect() as conn:
        names = conn.execute(sa.select(db.projects.c.name).where(db.projects.c.archived.is_(False))
                             .order_by(db.projects.c.name)).scalars().all()
    out = []
    for name in names:
        spec = load_project(project_root(name))
        for slot in spec.models or [None]:
            key = spec.model_key(slot)
            out.append({**status(key), "servable": "serve" in spec.entrypoints,
                        "production": models.production_version(key)})
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


DRIFT_FAMILIES = ("prediction_confidence", "predictions_per_input")


def _histogram_at(name: str, project: str, at: float, window: int) -> list[tuple[str, float]]:
    data = _prometheus("/api/v1/query", {
        "query": f'sum by (le) (increase({name}_bucket{{project="{project}"}}[{window}s]))', "time": at})
    rows = [(r["metric"]["le"], float(r["value"][1])) for r in data.get("data", {}).get("result", [])]
    rows.sort(key=lambda r: float("inf") if r[0] == "+Inf" else float(r[0]))
    counts, previous = [], 0.0
    for le, cumulative in rows:
        counts.append((le, max(cumulative - previous, 0.0)))
        previous = max(cumulative, previous)
    return counts


def _timestamp(value: str) -> float:
    from datetime import datetime, timezone

    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?", value)
    base = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    return base + float(m.group(2) or 0)


def psi(reference: list[float], current: list[float], eps: float = 1e-4) -> float:
    import math

    r_total, c_total = sum(reference) or 1, sum(current) or 1
    out = 0.0
    for r, c in zip(reference, current):
        a, b = max(r / r_total, eps), max(c / c_total, eps)
        out += (b - a) * math.log(b / a)
    return out


def drift(project: str, window_minutes: int = 30) -> dict:
    st = status(project)
    if not st.get("running"):
        raise ContractError(f"{project} is not running")
    started = _timestamp(st["started_at"])
    now = time.time()
    window = int(min(window_minutes * 60, (now - started) / 2))
    if window < 120:
        return {"ready": False, "detail": "the service needs a few more minutes of history", "features": []}
    names = _prometheus("/api/v1/label/__name__/values", {"match[]": f'{{project="{project}"}}'}).get("data", [])
    families = sorted({n[:-7] for n in names if n.endswith("_bucket")
                       and (n.startswith("input_") or n[:-7] in DRIFT_FAMILIES)})
    features, idle = [], []
    for name in families:
        ref = _histogram_at(name, project, started + window, window)
        cur = _histogram_at(name, project, now, window)
        if not ref or not cur or sum(c for _, c in ref) == 0 or sum(c for _, c in cur) == 0:
            idle.append(name)
            continue
        value = psi([c for _, c in ref], [c for _, c in cur])
        features.append({
            "name": name, "psi": round(value, 4),
            "level": "stable" if value < 0.1 else "moderate" if value < 0.25 else "significant",
            "buckets": [le for le, _ in ref],
            "reference": [round(c, 1) for _, c in ref], "current": [round(c, 1) for _, c in cur],
        })
    return {"ready": True, "window_minutes": round(window / 60, 1), "reference_start": started,
            "features": features, "no_data": idle}


def _last(points: list) -> float | None:
    return points[-1][1] if points else None


def alerts() -> list[dict]:
    out = []

    def add(project, level, title, detail):
        out.append({"project": project, "level": level, "title": title, "detail": detail})

    for d in deployments():
        key = d["project"]
        if not d.get("running"):
            continue
        if not d.get("healthy"):
            add(key, "critical", "Service not answering", "The container runs but /metrics does not respond.")
            continue
        if d.get("production") and d.get("version") != d["production"]:
            add(key, "warning", "Not the production version",
                f"The service runs v{d['version']} while v{d['production']} is in production.")
        try:
            live = live_metrics(key, 5, 15)
        except ContractError:
            continue
        errors = _last(live.get("error_rate", []))
        if errors is not None and errors > 0.01:
            add(key, "critical" if errors > 0.05 else "warning", "Errors",
                f"{errors:.1%} of requests failed over the last minute.")
        project, slot = split_key(key)
        contract = models._contract(key)
        limits = (contract.get("constraints") or {}).get(d.get("profile") or "", {})
        p95 = _last(live.get("latency_p95_ms", []))
        if p95 is not None and limits.get("latency_p95_ms") and p95 > limits["latency_p95_ms"]:
            add(key, "warning", "Latency over the target",
                f"p95 {p95:.0f} ms, the {d['profile']} target is {limits['latency_p95_ms']} ms.")
        res = resources(key)
        if res and limits.get("ram_mb") and res["mem_mb"] > limits["ram_mb"]:
            add(key, "warning", "Memory over the target",
                f"{res['mem_mb']:.0f} MB used, the {d['profile']} target is {limits['ram_mb']} MB.")
        try:
            dr = drift(key)
        except ContractError:
            dr = {"features": []}
        shifted = [f["name"] for f in dr.get("features", []) if f["level"] == "significant"]
        if shifted:
            add(key, "warning", "Input or prediction drift", "Significant shift on " + ", ".join(shifted) + ".")
    return out
