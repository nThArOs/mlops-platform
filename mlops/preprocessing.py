"""Files a model depends on besides its weights (input transforms, codec settings), pinned per version.

A training run stores a copy of the files listed under `preprocessing` in project.yaml with the model.
Every later run of that version (evaluate, benchmark, export, serve) mounts the copies over the project's
files, so a model always sees the inputs it was trained on even after the project changes them.
"""
import hashlib
from pathlib import Path

ARTIFACT_DIR = "preprocessing"


def digest(root: Path, files: list[str]) -> str | None:
    if not files:
        return None
    h = hashlib.sha256()
    for rel in sorted(files):
        h.update(rel.encode())
        h.update((root / rel).read_bytes())
    return h.hexdigest()[:12]


def mounts(snapshot: Path | None, files: list[str], workdir: str) -> list[str]:
    """docker -v arguments putting the pinned copies over the project's files."""
    from .paths import to_host

    if snapshot is None:
        return []
    out = []
    for rel in files:
        src = snapshot / rel
        if src.is_file():
            out += ["-v", f"{to_host(src)}:{workdir}/{rel}:ro"]
    return out
