import json
import os
import platform
import re
import subprocess
import sys
import time
from pathlib import Path

import mlflow
import yaml
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from . import cpus, datasets, db, models
from .paths import to_host
from .config import ROOT, load_config
from .project import ContractError, Project, split_key

CONTAINER_RUN_DIR = "/mlops/run"
CONTAINER_MODEL_DIR = "/mlops/model"
CONTAINER_CONFIG_DIR = "/mlops/config"


def load_profile(cfg: dict, name: str) -> dict:
    profiles = yaml.safe_load((ROOT / cfg["profiles_file"]).read_text(encoding="utf-8"))["profiles"]
    if name not in profiles:
        raise ContractError(f"unknown hardware profile: {name} (available: {', '.join(profiles)})")
    return profiles[name]


def render_command(template: str, values: dict) -> str:
    def replace(match):
        key = match.group(1)
        if values.get(key) is None:
            raise ContractError(f"no value for placeholder {{{key}}}, pass --{key.replace('_', '-')}")
        return str(values[key])

    return re.sub(r"\{(\w+)\}", replace, template)


def flatten_metrics(data, prefix: str = "") -> dict[str, float]:
    out = {}
    if isinstance(data, dict):
        for key, value in data.items():
            if key == "hardware" and not prefix:
                continue
            out.update(flatten_metrics(value, f"{prefix}{key}."))
    elif isinstance(data, (int, float)) and not isinstance(data, bool):
        out[re.sub(r"[^\w\-. /]", "_", prefix[:-1])] = float(data)
    return out


def flatten_params(data, prefix: str = "") -> dict[str, str]:
    out = {}
    if isinstance(data, dict):
        for key, value in data.items():
            out.update(flatten_params(value, f"{prefix}{key}."))
    else:
        out[prefix[:-1]] = json.dumps(data) if isinstance(data, (list, tuple)) else str(data)
    return out


def collect_outputs(project: Project, patterns: dict[str, str], since: float) -> dict[str, list[Path]]:
    found = {}
    for kind, pattern in patterns.items():
        files = [p for p in project.root.glob(pattern) if p.is_file() and p.stat().st_mtime >= since]
        found[kind] = sorted(files)
    return found


def git_state(path: Path) -> dict[str, str]:
    def git(*args):
        r = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace")
        return r.stdout.strip() if r.returncode == 0 else ""

    commit = git("rev-parse", "HEAD")
    if not commit:
        return {}
    return {"git.commit": commit, "git.dirty": str(bool(git("status", "--porcelain")))}


def image_id(image: str) -> str:
    r = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", image], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise ContractError(f"docker image not found: {image} (build it first)")
    return r.stdout.strip()


def host_hardware(profile_name: str, profile: dict) -> dict:
    return {
        "profile": profile_name,
        "runner": profile.get("runner", "local"),
        "cpus_limit": profile.get("cpus"),
        "memory_limit": profile.get("memory"),
        "measured": profile.get("runner") == "agent",
        "host_platform": platform.platform(),
        "host_processor": platform.processor(),
        "host_cpu_count": os.cpu_count(),
    }


def save_project(project: Project) -> None:
    stmt = pg_insert(db.projects).values(
        name=project.name, root=to_host(project.root), contract=project.raw)
    stmt = stmt.on_conflict_do_update(index_elements=["name"], set_={
        "root": stmt.excluded.root, "contract": stmt.excluded.contract, "updated_at": func.now()})
    with db.engine().begin() as conn:
        conn.execute(stmt)


def resolve_datasets(project: Project, refs: list[str]) -> list[tuple[dict, str]]:
    out = []
    for ref in refs:
        name, _ = datasets.parse_ref(ref)
        if name not in project.datasets:
            declared = ", ".join(project.datasets) or "none"
            raise ContractError(f"dataset {name} is not declared in project.yaml (declared: {declared})")
        out.append((datasets.get_version(ref), project.datasets[name].mount))
    return out


def run_entrypoint(project: Project, entrypoint: str, profile_name: str | None = None, config: str | None = None,
                   values: dict | None = None, dataset_refs: list[str] | None = None, slot: str | None = None,
                   variant: str | None = None) -> int:
    cfg = load_config()
    if entrypoint not in project.entrypoints:
        raise ContractError(f"entrypoint not declared: {entrypoint}")
    ep = project.entrypoints[entrypoint]
    profile_name = profile_name or cfg["default_profile"]
    profile = load_profile(cfg, profile_name)
    if profile.get("runner", "local") != "local":
        raise ContractError(f"runner not supported yet: {profile['runner']}")

    values = dict(values or {})
    model_ref = values.get("model")
    registry_model = models.resolve(model_ref) if model_ref and models.is_ref(model_ref) else None
    if registry_model:
        ref_project, ref_slot = split_key(registry_model[0])
        if ref_project != project.name:
            raise ContractError(f"{model_ref} belongs to {ref_project}, not {project.name}")
        if slot and ref_slot != slot:
            raise ContractError(f"{model_ref} is not a {slot} model")
        slot = ref_slot
    key = project.model_key(slot)
    slot_vars = project.slot_vars(slot)
    values = {**slot_vars, **values}
    mounted = resolve_datasets(project, dataset_refs or [])
    if len(mounted) == 1:
        values["dataset"] = mounted[0][0]["name"]
        values["dataset_path"] = f"{project.workdir}/{mounted[0][1]}"

    config = config or ep.config
    external_config = Path(config) if config and Path(config).is_absolute() else None
    if external_config:
        if not external_config.is_file():
            raise ContractError(f"config not found: {external_config}")
        config_host = external_config
        config = f"{CONTAINER_CONFIG_DIR}/{external_config.name}"
    else:
        config_host = project.root / config if config else None
    if registry_model:
        values["model"] = CONTAINER_MODEL_DIR
    command = render_command(ep.command, {**values, "config": config, "run_dir": CONTAINER_RUN_DIR})
    image = project.image_for(slot)
    img_id = image_id(image)
    hardware = host_hardware(profile_name, profile)
    cpuset = cpus.pin(cfg, "jobs", profile.get("cpus"))
    hardware["cpuset"] = cpuset
    save_project(project)

    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", cfg["tracking_uri"]))
    mlflow.set_experiment(project.name)

    with mlflow.start_run(run_name=entrypoint) as run:
        run_id = run.info.run_id
        run_dir = (ROOT / cfg["runs_dir"] / project.name / run_id).resolve()
        run_dir.mkdir(parents=True, exist_ok=True)

        volumes = [
            "-v", f"{to_host(project.root)}:{project.workdir}",
            "-v", f"{to_host(run_dir)}:{CONTAINER_RUN_DIR}",
        ]
        tags = {"image_id": img_id, "estimated": str(not hardware["measured"]), "mlops.model": key,
                **git_state(project.root)}
        if registry_model:
            name, version = registry_model
            model_path = models.download(name, version, run_dir.parent / f"{run_id}_model")
            target = CONTAINER_MODEL_DIR + (f"/{model_path.name}" if model_path.is_file() else "")
            volumes += ["-v", f"{to_host(model_path.parent if model_path.is_file() else model_path)}:{CONTAINER_MODEL_DIR}:ro"]
            command = command.replace(CONTAINER_MODEL_DIR, target, 1)
            tags.update({"model.name": name, "model.version": str(version)})
        for version, mount in mounted:
            volumes += ["-v", f"{to_host(datasets.checkout(version))}:{project.workdir}/{mount}:ro"]
            tags[f"dataset.{version['name']}"] = f"v{version['version']}"
        if external_config:
            volumes += ["-v", f"{to_host(external_config.parent)}:{CONTAINER_CONFIG_DIR}:ro"]

        params = {
            "entrypoint": entrypoint,
            "command": command,
            "image": image,
            "profile": profile_name,
            **{k: v for k, v in values.items() if v is not None and k != "dataset_path"},
        }
        if model_ref:
            params["model"] = model_ref
        if config:
            if not config_host.is_file():
                raise ContractError(f"config not found: {config_host}")
            params["config"] = str(external_config) if external_config else config
            params.update(flatten_params(yaml.safe_load(config_host.read_text(encoding="utf-8")) or {}, "config."))
        mlflow.log_params(params)
        mlflow.set_tags(tags)
        mlflow.log_dict(hardware, "hardware.json")
        if config:
            mlflow.log_artifact(str(config_host), "config")
        for version, mount in mounted:
            datasets.link_run(run_id, project.name, entrypoint, version["id"], mount)

        container = f"mlops-{run_id[:12]}"
        docker_cmd = ["docker", "run", "--rm", "--name", container, *volumes, "-w", project.workdir,
                      "-e", f"MLFLOW_TRACKING_URI={cfg['container_tracking_uri']}",
                      "-e", f"MLFLOW_RUN_ID={run_id}",
                      "-e", f"MLFLOW_EXPERIMENT_NAME={project.name}",
                      "-e", f"MLFLOW_RUN={entrypoint}",
                      "-e", "MLFLOW_KEEP_RUN_ACTIVE=true",
                      "-e", f"MLOPS_RUN_DIR={CONTAINER_RUN_DIR}",
                      "-e", f"MLOPS_PROFILE={profile_name}",
                      "-e", "MLOPS_DATASETS=" + ",".join(f"{v['name']}={mount}" for v, mount in mounted)]
        if profile.get("cpus"):
            docker_cmd += ["--cpus", str(profile["cpus"])]
        if cpuset:
            docker_cmd += ["--cpuset-cpus", cpuset]
        if os.environ.get("MLOPS_JOB_ID"):
            docker_cmd += ["--label", f"mlops.job={os.environ['MLOPS_JOB_ID']}"]
        if profile.get("memory"):
            docker_cmd += ["--memory", str(profile["memory"])]
        if project.shm_size:
            docker_cmd += ["--shm-size", str(project.shm_size)]
        docker_cmd += ["--entrypoint", "sh", image, "-c", command]

        print(f"run {run_id} ({project.name}/{entrypoint}, profile {profile_name})")
        for version, mount in mounted:
            print(f"dataset {version['name']}@v{version['version']} -> {mount}")
        if registry_model:
            print(f"model {registry_model[0]}@v{registry_model[1]}")
        print(f"$ {command}")
        started = time.time() - 2
        log_path = run_dir / "stdout.log"
        status, returncode = "FAILED", 1
        try:
            with open(log_path, "w", encoding="utf-8") as log:
                proc = subprocess.Popen(docker_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, encoding="utf-8", errors="replace")
                for line in proc.stdout:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    log.write(line)
                    log.flush()
                returncode = proc.wait()
            status = "FINISHED" if returncode == 0 else "FAILED"
        except KeyboardInterrupt:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            status, returncode = "KILLED", 130
        duration = time.time() - started - 2

        mlflow.log_metric("duration_s", round(duration, 2))
        mlflow.set_tag("exit_code", str(returncode))
        mlflow.log_artifact(str(log_path))

        outputs = collect_outputs(project, {k: render_command(v, slot_vars) for k, v in ep.outputs.items()}, started)
        metric_files = outputs.get("metrics", [])
        all_metrics, confusion, extras = {}, None, {}
        for path in metric_files:
            data = json.loads(path.read_text(encoding="utf-8"))
            metrics = flatten_metrics(data)
            if len(metric_files) > 1:
                metrics = {f"{path.stem}.{k}": v for k, v in metrics.items()}
            all_metrics.update(metrics)
            if isinstance(data, dict) and isinstance(data.get("confusion_matrix"), dict) and confusion is None:
                confusion = data["confusion_matrix"]
            if isinstance(data, dict):
                extras.update({k: data[k] for k in ("curves", "slices", "intervals") if isinstance(data.get(k), dict)})
            if isinstance(data, dict) and isinstance(data.get("hardware"), dict):
                mlflow.log_dict(data["hardware"], f"hardware_{path.stem}.json")
            mlflow.log_artifact(str(path), "metrics")
        if all_metrics:
            mlflow.log_metrics(all_metrics)
        for kind, files in outputs.items():
            if kind == "metrics":
                continue
            for path in files:
                mlflow.log_artifact(str(path), kind)
        for path in run_dir.iterdir():
            if path.name != "stdout.log":
                mlflow.log_artifact(str(path), "run_dir")

        missing = [k for k, v in outputs.items() if not v]
        if status == "FINISHED" and missing:
            print(f"warning: no new file for outputs: {', '.join(missing)}")
            mlflow.set_tag("missing_outputs", ",".join(missing))

        mlflow.end_run(status)

    if status == "FINISHED" and outputs.get("model"):
        version = models.register(key, run_id, variant or (config_host.stem if config_host else None),
                                  registry_model[1] if registry_model else None)
        print(f"registered {key}@v{version} (candidate)")
    if status == "FINISHED" and entrypoint == "benchmark" and registry_model and all_metrics:
        models.record_benchmark(registry_model[0], registry_model[1], run_id, profile_name, all_metrics,
                                bool(hardware["measured"]))
        print(f"benchmark of {registry_model[0]}@v{registry_model[1]} on {profile_name} recorded")
    if status == "FINISHED" and entrypoint == "evaluate" and registry_model and mounted and all_metrics:
        models.record_evaluation(registry_model[0], registry_model[1], run_id, [v["id"] for v, _ in mounted],
                                 all_metrics, confusion, extras or None)
        print(f"evaluation of {registry_model[0]}@v{registry_model[1]} recorded")
    print(f"{status.lower()} in {duration:.1f}s, exit code {returncode}")
    print(f"{cfg['public_tracking_uri']}/#/experiments/{run.info.experiment_id}/runs/{run_id}")
    return returncode
