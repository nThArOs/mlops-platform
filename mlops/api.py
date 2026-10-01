import mimetypes
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import datasets, models
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
        return {"allowed": True, "detail": models.check_promotion(project, version, dv)}
    except ContractError as e:
        return {"allowed": False, "detail": str(e)}


@app.post("/api/models/{project}/promote")
def promote(project: str, body: Promotion):
    dv = datasets.get_version(body.dataset)["id"] if body.dataset else None
    return {"detail": models.promote(project, body.version, dv, body.force, body.reason)}


@app.post("/api/models/{project}/rollback")
def rollback(project: str, body: Rollback):
    return {"version": models.rollback(project, body.reason)}


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
