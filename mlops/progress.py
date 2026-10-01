"""Progress of a running job read from the end of its log, and estimated times for the queue."""
import re
import statistics
from datetime import datetime, timezone

import sqlalchemy as sa

from . import db

# Ultralytics training line: "  3/8   0G   1.57 ...  640: 45% ━━━ 155/342 3.1s/it 9:18<8:24"
EPOCH = re.compile(r"^\s*(\d+)/(\d+)\s+\S*G\s")
STEP = re.compile(r"\s(\d+)/(\d+)\s+[\d.]+(?:s/it|it/s)")
VALIDATION = re.compile(r"\bClass\s+Images\b")
# generic marker any project can print: "[2/5] ..."
MARKER = re.compile(r"^\[(\d+)/(\d+)\]")


def parse(text: str, patterns: dict | None = None) -> dict | None:
    epoch_re = re.compile(patterns["epoch"], re.M) if patterns and patterns.get("epoch") else EPOCH
    step_re = re.compile(patterns["step"]) if patterns and patterns.get("step") else STEP
    epoch = step = None
    phase = "running"
    for line in reversed(text.split("\n")):
        if epoch is None and VALIDATION.search(line):
            phase = "validating"
            continue
        if m := epoch_re.search(line):
            epoch = int(m.group(1)), int(m.group(2))
            if s := step_re.search(line):
                step = int(s.group(1)), int(s.group(2))
            break
        if m := MARKER.search(line):
            done, total = int(m.group(1)), int(m.group(2))
            return {"fraction": done / total if total else None, "label": f"{done} of {total}", "phase": "running"}
    if epoch is None:
        return None
    e, total = epoch
    within = 1.0 if phase == "validating" else (step[0] / step[1] if step and step[1] else 0.0)
    fraction = min((e - 1 + within) / total, 0.999) if total else None
    label = f"epoch {e} of {total}" + (", validating" if phase == "validating" else "")
    return {"fraction": fraction, "label": label, "phase": phase, "epoch": e, "epochs": total}


def _seconds(start, end=None) -> float:
    end = end or datetime.now(timezone.utc)
    return (end - start).total_seconds()


def patterns(job: dict) -> dict | None:
    with db.engine().connect() as conn:
        contract = conn.execute(sa.select(db.projects.c.contract).where(db.projects.c.name == job["project"])).scalar()
    return (((contract or {}).get("entrypoints") or {}).get(job["entrypoint"]) or {}).get("progress")


def running(job: dict, text: str) -> dict | None:
    p = parse(text, patterns(job))
    elapsed = _seconds(job["started_at"]) if job.get("started_at") else None
    if p is None:
        typical = typical_duration(job)
        return {"fraction": None, "label": "starting" if elapsed and elapsed < 60 else "running",
                "elapsed_s": elapsed, "remaining_s": max(typical - elapsed, 0) if typical and elapsed else None}
    if elapsed and p["fraction"] and p["fraction"] > 0.02:
        remaining = elapsed * (1 - p["fraction"]) / p["fraction"]
    else:
        typical = typical_duration(job)
        remaining = max(typical - elapsed, 0) if typical and elapsed else None
    return {**p, "elapsed_s": elapsed, "remaining_s": remaining}


def typical_duration(job: dict) -> float | None:
    """Median duration of the last finished jobs of the same kind, as a first estimate."""
    j = db.jobs
    spec = job.get("spec") or {}
    query = (sa.select(j.c.started_at, j.c.finished_at, j.c.spec).where(
        j.c.status == "finished", j.c.model == job["model"], j.c.entrypoint == job["entrypoint"],
        j.c.started_at.is_not(None)).order_by(j.c.id.desc()).limit(20))
    with db.engine().connect() as conn:
        rows = conn.execute(query).all()
    same = [r for r in rows if (r.spec or {}).get("config") == spec.get("config")
            and (r.spec or {}).get("params") == spec.get("params")] or rows
    durations = [_seconds(r.started_at, r.finished_at) for r in same[:5]]
    return statistics.median(durations) if durations else None
