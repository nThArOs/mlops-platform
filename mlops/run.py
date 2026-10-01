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

from .project import ContractError, Project

ROOT = Path(__file__).resolve().parent.parent
CONTAINER_RUN_DIR = "/mlops/run"


def load_platform_config() -> dict:
    return yaml.safe_load((ROOT / "configs" / "platform.yaml").read_text(encoding="utf-8"))


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
        r = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else ""

    commit = git("rev-parse", "HEAD")
    if not commit:
        return {}
    return {"git.commit": commit, "git.dirty": str(bool(git("status", "--porcelain")))}


def image_id(image: str) -> str:
    r = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", image], capture_output=True, text=True)
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


def run_entrypoint(project: Project, entrypoint: str, profile_name: str | None = None, config: str | None = None,
                   values: dict | None = None) -> int:
    cfg = load_platform_config()
    if entrypoint not in project.entrypoints:
        raise ContractError(f"entrypoint not declared: {entrypoint}")
    ep = project.entrypoints[entrypoint]
    profile_name = profile_name or cfg["default_profile"]
    profile = load_profile(cfg, profile_name)
    if profile.get("runner", "local") != "local":
        raise ContractError(f"runner not supported yet: {profile['runner']}")

    config = config or ep.config
    command = render_command(ep.command, {**(values or {}), "config": config, "run_dir": CONTAINER_RUN_DIR})
    img_id = image_id(project.image)
    hardware = host_hardware(profile_name, profile)

    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", cfg["tracking_uri"]))
    mlflow.set_experiment(project.name)

    with mlflow.start_run(run_name=entrypoint) as run:
        run_id = run.info.run_id
        run_dir = (ROOT / cfg["runs_dir"] / project.name / run_id).resolve()
        run_dir.mkdir(parents=True, exist_ok=True)

        params = {
            "entrypoint": entrypoint,
            "command": command,
            "image": project.image,
            "profile": profile_name,
            **{k: v for k, v in (values or {}).items() if v is not None},
        }
        if config:
            config_path = project.root / config
            if not config_path.is_file():
                raise ContractError(f"config not found: {config_path}")
            params["config"] = config
            params.update(flatten_params(yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}, "config."))
        mlflow.log_params(params)
        mlflow.set_tags({"image_id": img_id, "estimated": str(not hardware["measured"]), **git_state(project.root)})
        mlflow.log_dict(hardware, "hardware.json")
        if config:
            mlflow.log_artifact(str(project.root / config), "config")

        container = f"mlops-{run_id[:12]}"
        docker_cmd = [
            "docker", "run", "--rm", "--name", container,
            "-v", f"{project.root}:{project.workdir}",
            "-v", f"{run_dir}:{CONTAINER_RUN_DIR}",
            "-w", project.workdir,
            "-e", f"MLFLOW_TRACKING_URI={cfg['container_tracking_uri']}",
            "-e", f"MLFLOW_RUN_ID={run_id}",
            "-e", f"MLOPS_RUN_DIR={CONTAINER_RUN_DIR}",
            "-e", f"MLOPS_PROFILE={profile_name}",
            "--entrypoint", "sh",
        ]
        if profile.get("cpus"):
            docker_cmd[3:3] = ["--cpus", str(profile["cpus"])]
        if profile.get("memory"):
            docker_cmd[3:3] = ["--memory", str(profile["memory"])]
        if project.shm_size:
            docker_cmd[3:3] = ["--shm-size", str(project.shm_size)]
        docker_cmd += [project.image, "-c", command]

        print(f"run {run_id} ({project.name}/{entrypoint}, profile {profile_name})")
        print(f"$ {command}")
        started = time.time() - 2
        log_path = run_dir / "stdout.log"
        status = "FAILED"
        returncode = 1
        try:
            with open(log_path, "w", encoding="utf-8") as log:
                proc = subprocess.Popen(docker_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, encoding="utf-8", errors="replace")
                for line in proc.stdout:
                    sys.stdout.write(line)
                    log.write(line)
                returncode = proc.wait()
            status = "FINISHED" if returncode == 0 else "FAILED"
        except KeyboardInterrupt:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            status = "KILLED"
            returncode = 130
        duration = time.time() - started - 2

        mlflow.log_metric("duration_s", round(duration, 2))
        mlflow.set_tag("exit_code", str(returncode))
        mlflow.log_artifact(str(log_path))

        outputs = collect_outputs(project, ep.outputs, started)
        metric_files = outputs.get("metrics", [])
        for path in metric_files:
            data = json.loads(path.read_text(encoding="utf-8"))
            metrics = flatten_metrics(data)
            if len(metric_files) > 1:
                metrics = {f"{path.stem}.{k}": v for k, v in metrics.items()}
            if metrics:
                mlflow.log_metrics(metrics)
            if isinstance(data, dict) and isinstance(data.get("hardware"), dict):
                mlflow.log_dict(data["hardware"], f"hardware_{path.stem}.json")
            mlflow.log_artifact(str(path), "metrics")
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
        print(f"{status.lower()} in {duration:.1f}s, exit code {returncode}")
        print(f"{mlflow.get_tracking_uri()}/#/experiments/{run.info.experiment_id}/runs/{run_id}")
    return returncode
