"""Paths as the Docker host sees them, when the platform itself runs in a container.

Containers the platform starts are created by the host's Docker daemon, so their bind mounts need host
paths. The platform reads its own mounts once and translates both ways; outside a container both
functions return the path unchanged.
"""
import json
import socket
import subprocess
from functools import lru_cache
from pathlib import Path


def _norm(path: str) -> str:
    return path.replace("\\", "/").rstrip("/").lower()


@lru_cache
def mounts() -> tuple[tuple[str, str], ...]:
    """(host source, local destination) of this container's bind mounts."""
    if not Path("/.dockerenv").exists():
        return ()
    r = subprocess.run(["docker", "inspect", socket.gethostname()], capture_output=True, text=True)
    info = json.loads(r.stdout or "[]")
    return tuple((m["Source"], m["Destination"]) for m in (info[0]["Mounts"] if info else [])
                 if m.get("Type") == "bind")


def to_host(path: str | Path) -> str:
    p = str(path)
    for src, dst in sorted(mounts(), key=lambda m: -len(m[1])):
        if p == dst or p.startswith(dst + "/"):
            rest = p[len(dst):]
            return src + (rest.replace("/", "\\") if "\\" in src or ":" in src[:3] else rest)
    return p


def to_local(path: str | Path) -> Path:
    p = str(path)
    for src, dst in sorted(mounts(), key=lambda m: -len(m[0])):
        s = _norm(src)
        if _norm(p) == s or _norm(p).startswith(s + "/"):
            return Path(dst + p.replace("\\", "/")[len(s):])
    return Path(p)
