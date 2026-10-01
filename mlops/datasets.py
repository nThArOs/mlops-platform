import re
from pathlib import Path

import sqlalchemy as sa

from . import db
from .config import load_config, resolve
from .project import ContractError
from .store import Store

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,99}$")
REF_RE = re.compile(r"^([a-z0-9][a-z0-9_\-]*)(?:@v?(\d+))?$")


def store() -> Store:
    return Store(resolve(load_config()["store_dir"]))


def parse_ref(ref: str) -> tuple[str, int | None]:
    match = REF_RE.match(ref)
    if not match:
        raise ContractError(f"invalid dataset reference: {ref} (expected name or name@vN)")
    return match.group(1), int(match.group(2)) if match.group(2) else None


def _split_counts(files: dict, splits: dict[str, str]) -> dict:
    out = {}
    for name, prefix in splits.items():
        prefix = prefix.strip("/")
        count = sum(1 for rel in files if rel == prefix or rel.startswith(prefix + "/"))
        if count == 0:
            raise ContractError(f"split {name}: no file under {prefix}/")
        out[name] = {"path": prefix, "files": count}
    return out


def add_version(name: str, folder: str | Path, license: str | None = None, source: str | None = None,
                fmt: str | None = None, description: str | None = None, splits: dict[str, str] | None = None,
                note: str | None = None, link: bool = True) -> dict:
    if not NAME_RE.match(name):
        raise ContractError(f"invalid dataset name: {name} (lowercase letters, digits, - and _)")
    folder = Path(folder).resolve()
    if not folder.is_dir():
        raise ContractError(f"folder not found: {folder}")

    with db.engine().begin() as conn:
        dataset = conn.execute(sa.select(db.datasets).where(db.datasets.c.name == name)).mappings().first()
        if dataset is None and not license:
            raise ContractError("a new dataset needs a license (--license)")

    st = store()
    files, counts = st.add_folder(folder, link)
    if not files:
        raise ContractError(f"no file in {folder}")
    digest = st.save_manifest(files)
    split_info = _split_counts(files, splits or {})

    with db.engine().begin() as conn:
        dataset = conn.execute(sa.select(db.datasets).where(db.datasets.c.name == name)).mappings().first()
        fields = {k: v for k, v in {"license": license, "source": source, "format": fmt,
                                     "description": description}.items() if v is not None}
        if dataset is None:
            dataset_id = conn.execute(sa.insert(db.datasets).values(name=name, **fields)).inserted_primary_key[0]
        else:
            dataset_id = dataset["id"]
            if fields:
                conn.execute(sa.update(db.datasets).where(db.datasets.c.id == dataset_id).values(**fields))

        latest = conn.execute(
            sa.select(db.dataset_versions).where(db.dataset_versions.c.dataset_id == dataset_id)
            .order_by(db.dataset_versions.c.version.desc()).limit(1)
        ).mappings().first()
        if latest and latest["manifest_hash"] == digest and latest["splits"] == split_info:
            return {"name": name, "version": latest["version"], "unchanged": True, **counts}

        version = (latest["version"] + 1) if latest else 1
        conn.execute(sa.insert(db.dataset_versions).values(
            dataset_id=dataset_id, version=version, parent_id=latest["id"] if latest else None,
            manifest_hash=digest, files=len(files), bytes=sum(f["size"] for f in files.values()),
            splits=split_info, note=note,
        ))
    return {"name": name, "version": version, "unchanged": False, "files": len(files), **counts}


def _version_query():
    d, v = db.datasets, db.dataset_versions
    return sa.select(v, d.c.name, d.c.license, d.c.source, d.c.format, d.c.description).join(d, d.c.id == v.c.dataset_id)


def get_version(ref: str) -> dict:
    name, version = parse_ref(ref)
    v = db.dataset_versions
    query = _version_query().where(db.datasets.c.name == name, v.c.archived.is_(False))
    query = query.where(v.c.version == version) if version else query.order_by(v.c.version.desc()).limit(1)
    with db.engine().connect() as conn:
        row = conn.execute(query).mappings().first()
    if row is None:
        raise ContractError(f"dataset not found: {ref}")
    return dict(row)


def list_datasets() -> list[dict]:
    d, v = db.datasets, db.dataset_versions
    latest = sa.select(v.c.dataset_id, sa.func.max(v.c.version).label("version"),
                       sa.func.count().label("versions")).group_by(v.c.dataset_id).subquery()
    query = (
        sa.select(d.c.name, d.c.license, d.c.format, latest.c.version, latest.c.versions, v.c.files, v.c.bytes,
                  v.c.created_at)
        .join(latest, latest.c.dataset_id == d.c.id)
        .join(v, sa.and_(v.c.dataset_id == d.c.id, v.c.version == latest.c.version))
        .where(d.c.archived.is_(False)).order_by(d.c.name)
    )
    with db.engine().connect() as conn:
        return [dict(r) for r in conn.execute(query).mappings()]


def diff(ref_a: str, ref_b: str) -> dict[str, list[str]]:
    st = store()
    a = st.load_manifest(get_version(ref_a)["manifest_hash"])
    b = st.load_manifest(get_version(ref_b)["manifest_hash"])
    return {
        "added": sorted(set(b) - set(a)),
        "removed": sorted(set(a) - set(b)),
        "modified": sorted(k for k in set(a) & set(b) if a[k]["hash"] != b[k]["hash"]),
    }


def verify(ref: str) -> list[str]:
    return store().verify(get_version(ref)["manifest_hash"])


def checkout(version: dict) -> Path:
    return store().checkout(version["manifest_hash"])


def link_run(run_id: str, project: str, entrypoint: str, version_id: int, mount: str) -> None:
    with db.engine().begin() as conn:
        conn.execute(sa.insert(db.run_datasets).values(
            run_id=run_id, project=project, entrypoint=entrypoint, dataset_version_id=version_id, mount=mount))


def usage(ref: str) -> list[dict]:
    version = get_version(ref)
    rd = db.run_datasets
    with db.engine().connect() as conn:
        rows = conn.execute(sa.select(rd).where(rd.c.dataset_version_id == version["id"])
                            .order_by(rd.c.created_at)).mappings()
        return [dict(r) for r in rows]


def ref_of(version_id: int) -> str:
    with db.engine().connect() as conn:
        row = conn.execute(_version_query().where(db.dataset_versions.c.id == version_id)).mappings().first()
    return f"{row['name']}@v{row['version']}"


def dataset_info(name: str) -> dict:
    with db.engine().connect() as conn:
        row = conn.execute(sa.select(db.datasets).where(db.datasets.c.name == name)).mappings().first()
    if row is None:
        raise ContractError(f"dataset not found: {name}")
    return dict(row)


def list_versions(name: str) -> list[dict]:
    dataset = dataset_info(name)
    v, rd = db.dataset_versions, db.run_datasets
    runs = sa.select(rd.c.dataset_version_id, sa.func.count().label("runs")).group_by(rd.c.dataset_version_id).subquery()
    query = (sa.select(v, sa.func.coalesce(runs.c.runs, 0).label("runs"))
             .outerjoin(runs, runs.c.dataset_version_id == v.c.id)
             .where(v.c.dataset_id == dataset["id"]).order_by(v.c.version.desc()))
    with db.engine().connect() as conn:
        return [dict(r) for r in conn.execute(query).mappings()]


def browse(ref: str, prefix: str = "", offset: int = 0, limit: int = 200) -> dict:
    manifest = store().load_manifest(get_version(ref)["manifest_hash"])
    prefix = prefix.strip("/")
    base = prefix + "/" if prefix else ""
    dirs, files = {}, []
    for rel, entry in manifest.items():
        if not rel.startswith(base):
            continue
        head, sep, _ = rel[len(base):].partition("/")
        if sep:
            dirs[head] = dirs.get(head, 0) + 1
        else:
            files.append({"path": rel, "name": head, "size": entry["size"]})
    files.sort(key=lambda f: f["name"])
    return {
        "prefix": prefix,
        "dirs": [{"name": k, "files": n} for k, n in sorted(dirs.items())],
        "files": files[offset:offset + limit],
        "total_files": len(files),
    }


def file_path(ref: str, path: str) -> Path:
    st = store()
    entry = st.load_manifest(get_version(ref)["manifest_hash"]).get(path)
    if entry is None:
        raise ContractError(f"file not found in {ref}: {path}")
    return st.object_path(entry["hash"])


def archive_version(ref: str) -> None:
    version = get_version(ref)
    with db.engine().begin() as conn:
        conn.execute(sa.update(db.dataset_versions).where(db.dataset_versions.c.id == version["id"])
                     .values(archived=True))
