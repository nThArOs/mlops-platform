import hashlib
import json
import os
import shutil
import stat
import sys
from pathlib import Path

CHUNK = 1 << 20
READ_ONLY = stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def _force_remove(func, path, _):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def rmtree(path: Path) -> None:
    key = "onexc" if sys.version_info >= (3, 12) else "onerror"
    shutil.rmtree(path, **{key: _force_remove})


def _link_or_copy(src: Path, dst: Path, link: bool) -> bool:
    if link:
        try:
            os.link(src, dst)
            return True
        except OSError:
            pass
    shutil.copy2(src, dst)
    return False


class Store:
    """Content-addressed file store: objects/<sha256>, one manifest per dataset version."""

    def __init__(self, root: Path):
        self.root = root
        self.objects = root / "objects"
        self.manifests = root / "manifests"
        self.checkouts = root / "checkouts"

    def object_path(self, digest: str) -> Path:
        return self.objects / digest[:2] / digest[2:]

    def put_file(self, src: Path, link: bool) -> tuple[str, str]:
        digest = file_hash(src)
        dst = self.object_path(digest)
        if dst.exists():
            return digest, "existing"
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(dst.name + ".tmp")
        if tmp.exists():
            os.chmod(tmp, stat.S_IWRITE | READ_ONLY)
            tmp.unlink()
        linked = _link_or_copy(src, tmp, link)
        os.replace(tmp, dst)
        os.chmod(dst, READ_ONLY)
        return digest, "linked" if linked else "copied"

    def add_folder(self, folder: Path, link: bool = True) -> tuple[dict, dict]:
        files, counts = {}, {"linked": 0, "copied": 0, "existing": 0}
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            digest, how = self.put_file(path, link)
            counts[how] += 1
            files[path.relative_to(folder).as_posix()] = {"hash": digest, "size": path.stat().st_size}
        return files, counts

    def save_manifest(self, files: dict) -> str:
        data = json.dumps(files, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(data.encode()).hexdigest()
        path = self.manifests / f"{digest}.json"
        if not path.exists():
            self.manifests.mkdir(parents=True, exist_ok=True)
            path.write_text(data, encoding="utf-8")
        return digest

    def load_manifest(self, digest: str) -> dict:
        return json.loads((self.manifests / f"{digest}.json").read_text(encoding="utf-8"))

    def checkout(self, digest: str) -> Path:
        dst = self.checkouts / digest
        done = self.checkouts / f"{digest}.done"
        if done.exists():
            return dst
        tmp = self.checkouts / f"{digest}.tmp"
        if tmp.exists():
            rmtree(tmp)
        for rel, entry in self.load_manifest(digest).items():
            target = tmp / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            _link_or_copy(self.object_path(entry["hash"]), target, link=True)
        tmp.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            rmtree(dst)
        tmp.rename(dst)
        done.touch()
        return dst

    def verify(self, digest: str) -> list[str]:
        bad = []
        for rel, entry in self.load_manifest(digest).items():
            path = self.object_path(entry["hash"])
            if not path.exists() or file_hash(path) != entry["hash"]:
                bad.append(rel)
        return bad
