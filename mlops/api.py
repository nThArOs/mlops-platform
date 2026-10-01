import mimetypes
import shutil
import tempfile
import zipfile
from pathlib import Path

import yaml

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import datasets, deploy, jobs, models
from .project import load_project
from .run import load_profile
from .config import ROOT, load_config, resolve
from .project import ContractError
from .store import rmtree

app = FastAPI(title="mlops-platform", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.exception_handler(ContractError)
def contract_error(_: Request, exc: ContractError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def ref(name: str, version: int | None = None) -> str:
    return f"{name}@v{version}" if version else name


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/info")
def info():
    cfg = load_config()
    return {"mlflow_url": cfg["tracking_uri"], "prometheus_url": cfg["prometheus_url"]}


class DatasetFolder(BaseModel):
    name: str
    folder: str
    license: str | None = None
    source: str | None = None
    format: str | None = None
    description: str | None = None
    splits: dict[str, str] = {}
    note: str | None = None
    copy_files: bool = False


@app.get("/api/datasets")
def list_datasets():
    return datasets.list_datasets()


@app.post("/api/datasets")
def add_dataset(body: DatasetFolder):
    return datasets.add_version(body.name, body.folder, body.license, body.source, body.format, body.description,
                                body.splits, body.note, link=not body.copy_files)


@app.post("/api/datasets/upload")
def upload_dataset(file: UploadFile = File(...), name: str = Form(...), license: str | None = Form(None),
                   source: str | None = Form(None), format: str | None = Form(None),
                   description: str | None = Form(None), note: str | None = Form(None),
                   splits: str | None = Form(None)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise ContractError("upload a .zip archive")
    max_mb = load_config().get("upload_max_mb", 2048)
    tmp_root = resolve(load_config()["store_dir"]) / "uploads"
    tmp_root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(dir=tmp_root))
    try:
        archive = tmp / "upload.zip"
        with open(archive, "wb") as out:
            shutil.copyfileobj(file.file, out)
        if archive.stat().st_size > max_mb * 1024 * 1024:
            raise ContractError(f"archive larger than {max_mb} MB, add the folder instead")
        folder = tmp / "content"
        with zipfile.ZipFile(archive) as zf:
            for member in zf.namelist():
                target = (folder / member).resolve()
                if not target.is_relative_to(folder.resolve()):
                    raise ContractError(f"unsafe path in archive: {member}")
            zf.extractall(folder)
        entries = [p for p in folder.iterdir() if not p.name.startswith("__MACOSX")]
        if len(entries) == 1 and entries[0].is_dir():
            folder = entries[0]
        split_map = dict(s.split("=", 1) for s in (splits or "").split(",") if "=" in s)
        return datasets.add_version(name, folder, license, source, format, description, split_map, note, link=False)
    finally:
        rmtree(tmp)


@app.get("/api/datasets/{name}")
def get_dataset(name: str):
    production = models.production_dataset_ids()
    versions = [{**v, "in_production": v["id"] in production} for v in datasets.list_versions(name)]
    return {**datasets.dataset_info(name), "versions": versions}


@app.get("/api/datasets/{name}/versions/{version}")
def get_dataset_version(name: str, version: int):
    v = datasets.get_version(ref(name, version))
    return {**v, "usage": datasets.usage(ref(name, version)),
            "in_production": v["id"] in models.production_dataset_ids()}


@app.get("/api/datasets/{name}/versions/{version}/browse")
def browse_dataset(name: str, version: int, prefix: str = "", offset: int = 0, limit: int = 200):
    return datasets.browse(ref(name, version), prefix, offset, min(limit, 1000))


@app.get("/api/datasets/{name}/versions/{version}/file")
def dataset_file(name: str, version: int, path: str):
    obj = datasets.file_path(ref(name, version), path)
    media = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(obj, media_type=media, filename=Path(path).name, content_disposition_type="inline")


@app.get("/api/datasets/{name}/diff")
def diff_dataset(name: str, a: int, b: int):
    return datasets.diff(ref(name, a), ref(name, b))


@app.post("/api/datasets/{name}/versions/{version}/archive")
def archive_dataset(name: str, version: int):
    v = datasets.get_version(ref(name, version))
    if v["id"] in models.production_dataset_ids():
        raise HTTPException(409, f"{name}@v{version} is used by a model in production")
    datasets.archive_version(ref(name, version))
    return {"archived": True}


class Promotion(BaseModel):
    version: int
    dataset: str | None = None
    force: bool = False
    reason: str | None = None


class Rollback(BaseModel):
    reason: str | None = None


@app.get("/api/models")
def list_models():
    return models.list_projects()


@app.get("/api/models/{project}")
def get_model(project: str):
    return {"versions": models.list_versions(project), "history": models.history(project),
            "production": models.production_version(project)}


@app.get("/api/models/{project}/versions/{version}/check")
def check_promotion(project: str, version: int, dataset: str | None = None):
    dv = datasets.get_version(dataset)["id"] if dataset else None
    try:
        return models.promotion_checks(project, version, dv)
    except ContractError as e:
        return {"allowed": False, "detail": str(e), "checks": []}


@app.post("/api/models/{project}/promote")
def promote(project: str, body: Promotion):
    dv = datasets.get_version(body.dataset)["id"] if body.dataset else None
    detail = models.promote(project, body.version, dv, body.force, body.reason)
    return {"detail": detail, "deployment": deploy.follow_production(project)}


@app.post("/api/models/{project}/rollback")
def rollback(project: str, body: Rollback):
    version = models.rollback(project, body.reason)
    return {"version": version, "deployment": deploy.follow_production(project)}


class Start(BaseModel):
    version: int | None = None
    profile: str | None = None


@app.get("/api/production")
def list_deployments():
    return deploy.deployments()


@app.get("/api/production/{project}")
def deployment(project: str):
    return {**deploy.status(project), "production": models.production_version(project)}


@app.post("/api/production/{project}/start")
def start_service(project: str, body: Start):
    return deploy.start(project, body.version, body.profile)


@app.post("/api/production/{project}/stop")
def stop_service(project: str):
    return deploy.stop(project)


@app.get("/api/production/{project}/metrics")
def service_metrics(project: str, minutes: int = 60):
    minutes = max(5, min(minutes, 24 * 60))
    return deploy.live_metrics(project, minutes, step=max(5, minutes * 60 // 240))


@app.get("/api/production/{project}/frame")
def service_frame(project: str, view: str = "input", width: int = 960):
    st = deploy.status(project)
    if not st.get("running") or not st.get("port"):
        raise HTTPException(409, f"{project} is not running")
    data = deploy.frame(st["port"], view, width)
    if data is None:
        raise HTTPException(404, "this service has no preview")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/production/{project}/drift")
def service_drift(project: str, window: int = 30):
    return deploy.drift(project, max(2, min(window, 24 * 60)))


@app.get("/api/production/{project}/logs")
def service_logs(project: str, tail: int = 200):
    return {"logs": deploy.logs(project, min(tail, 2000))}


@app.get("/api/projects/{project}/options")
def project_options(project: str):
    spec = load_project(jobs.project_root(project))
    cfg = load_config()
    profiles = yaml.safe_load((ROOT / cfg["profiles_file"]).read_text(encoding="utf-8"))["profiles"]
    slots = []
    for name, d in spec.datasets.items():
        try:
            versions = [v["version"] for v in datasets.list_versions(name) if not v["archived"]]
        except Exception:
            versions = []
        slots.append({"name": name, "mount": d.mount, "versions": versions})
    configs = sorted(p.relative_to(spec.root).as_posix() for p in (spec.root / "configs").glob("*.y*ml"))         if (spec.root / "configs").is_dir() else []
    return {
        "project": spec.name,
        "models": [{"slot": s.name, "key": spec.model_key(s.name), "description": s.description}
                   for s in spec.models.values()] or [{"slot": None, "key": spec.name, "description": None}],
        "entrypoints": {n: {"config": e.config} for n, e in spec.entrypoints.items()},
        "datasets": slots,
        "configs": configs,
        "profiles": [{"name": n, **p} for n, p in profiles.items()],
        "default_profile": cfg["default_profile"],
    }


@app.get("/api/projects/{project}/config")
def project_config(project: str, path: str):
    root = jobs.project_root(project).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, "config not found")
    return yaml.safe_load(target.read_text(encoding="utf-8")) or {}


class JobSpec(BaseModel):
    project: str
    slot: str | None = None
    entrypoint: str = "train"
    config: str | None = None
    params: dict = {}
    datasets: list[str] = []
    profile: str | None = None
    variant: str | None = None
    model: str | None = None
    auto_evaluate: bool = False
    eval_datasets: list[str] = []
    values: dict[str, str] = {}
    benchmark_profiles: list[str] = []
    note: str | None = None


@app.post("/api/jobs")
def create_job(body: JobSpec):
    if body.profile:
        load_profile(load_config(), body.profile)
    return jobs.get(jobs.create(body.model_dump()))


@app.get("/api/jobs")
def list_jobs(model: str | None = None, limit: int = 50):
    return jobs.list_jobs(model, min(limit, 200))


@app.get("/api/jobs/{job_id}")
def get_job(job_id: int):
    return jobs.get(job_id)


@app.get("/api/runs/{run_id}/metrics")
def run_metrics(run_id: str):
    return models.metric_history(run_id)


@app.get("/api/jobs/{job_id}/log")
def job_log(job_id: int, offset: int = 0):
    return jobs.log(job_id, offset)


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: int):
    return jobs.cancel(job_id)


UI_DIST = ROOT / "ui" / "dist"
if UI_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=UI_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def ui(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        target = (UI_DIST / path).resolve()
        if path and target.is_file() and target.is_relative_to(UI_DIST):
            return FileResponse(target)
        return FileResponse(UI_DIST / "index.html")
