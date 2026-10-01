"""Pin containers to whole physical cores, so a benchmark never shares a core with a live service."""
import json
import subprocess


def parse_cpuset(text: str) -> set[int]:
    out: set[int] = set()
    for part in filter(None, (text or "").split(",")):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


def cores_of(cpus: set[int], threads_per_core: int) -> set[int]:
    return {c // threads_per_core for c in cpus}


def busy_cores(threads_per_core: int) -> set[int]:
    """Physical cores already given to a running container."""
    ids = subprocess.run(["docker", "ps", "-q"], capture_output=True, text=True).stdout.split()
    if not ids:
        return set()
    r = subprocess.run(["docker", "inspect", *ids], capture_output=True, text=True, encoding="utf-8")
    used: set[int] = set()
    for info in json.loads(r.stdout or "[]"):
        used |= cores_of(parse_cpuset(info["HostConfig"].get("CpusetCpus", "")), threads_per_core)
    return used


def allocate(pool: list[int], wanted: float | None, busy: set[int], threads_per_core: int) -> str | None:
    """Logical CPUs for a container: one thread on each of `wanted` free cores, or every thread of the
    free cores when the profile has no CPU limit. None when the pool can't hold it."""
    free = [c for c in pool if c not in busy]
    if wanted is None:
        cpus = [c * threads_per_core + t for c in free for t in range(threads_per_core)]
    else:
        n = max(1, int(-(-wanted // 1)))
        if len(free) < n:
            return None
        cpus = [c * threads_per_core for c in free[:n]]
    return ",".join(map(str, cpus)) or None


def pin(cfg: dict, kind: str, wanted: float | None) -> str | None:
    """Docker --cpuset-cpus value for a container of this kind (services or jobs), if pinning is set up."""
    pinning = cfg.get("cpu_pinning")
    if not pinning or kind not in pinning:
        return None
    tpc = pinning.get("threads_per_core", 1)
    return allocate(pinning[kind], wanted, busy_cores(tpc), tpc)
