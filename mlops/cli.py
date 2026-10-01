import argparse
import logging
import os
import sys

from .project import ContractError, load_project


def table(rows: list[dict], columns: list[str]) -> None:
    if not rows:
        print("(none)")
        return
    cells = [["" if r.get(c) is None else str(r[c]) for c in columns] for r in rows]
    widths = [max(len(c), *(len(row[i]) for row in cells)) for i, c in enumerate(columns)]
    print("  ".join(c.ljust(w) for c, w in zip(columns, widths)))
    for row in cells:
        print("  ".join(v.ljust(w) for v, w in zip(row, widths)))


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def parse_splits(items: list[str]) -> dict[str, str]:
    out = {}
    for item in items or []:
        name, sep, path = item.partition("=")
        if not sep or not name or not path:
            raise ContractError(f"invalid split: {item} (expected name=path)")
        out[name] = path
    return out


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mlops")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("validate", help="check a project.yaml")
    p.add_argument("project", help="project root")

    p = sub.add_parser("run", help="run a project entrypoint and log it")
    p.add_argument("project", help="project root")
    p.add_argument("entrypoint")
    p.add_argument("--profile", help="hardware profile from configs/hardware_profiles.yaml")
    p.add_argument("--config", help="config file relative to the project root")
    p.add_argument("--dataset", action="append", default=[], help="name or name@vN, repeatable")
    p.add_argument("--model", help="path in the project, or project@vN / project@alias from the registry")
    for name in ("split", "sample"):
        p.add_argument(f"--{name}")

    sv = sub.add_parser("serve", help="production service").add_subparsers(dest="action", required=True)
    p = sv.add_parser("start", help="deploy the production version, or --version")
    p.add_argument("project")
    p.add_argument("--version", type=lambda v: int(v.lstrip("v")))
    p.add_argument("--profile")
    for name in ("stop", "status", "logs"):
        sv.add_parser(name).add_argument("project")

    p = sub.add_parser("api", help="start the platform API and UI")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")

    ds = sub.add_parser("dataset", help="dataset registry").add_subparsers(dest="action", required=True)
    p = ds.add_parser("add", help="register a folder as a new dataset version")
    p.add_argument("name")
    p.add_argument("folder")
    p.add_argument("--license")
    p.add_argument("--source")
    p.add_argument("--format")
    p.add_argument("--description")
    p.add_argument("--split", action="append", help="name=subfolder, repeatable")
    p.add_argument("--note")
    p.add_argument("--copy", action="store_true", help="copy files instead of hard links")
    ds.add_parser("list")
    p = ds.add_parser("show")
    p.add_argument("ref")
    p = ds.add_parser("diff")
    p.add_argument("a")
    p.add_argument("b")
    p = ds.add_parser("verify")
    p.add_argument("ref")

    md = sub.add_parser("model", help="model registry").add_subparsers(dest="action", required=True)
    p = md.add_parser("list")
    p.add_argument("project", help="project name")
    p = md.add_parser("import", help="register an existing model file with its training datasets")
    p.add_argument("project", help="project root")
    p.add_argument("path", help="model file or folder")
    p.add_argument("--dataset", action="append", default=[], help="training dataset, name@vN, repeatable")
    p.add_argument("--metrics", help="metrics JSON produced when the model was trained")
    p.add_argument("--note")
    p = md.add_parser("promote")
    p.add_argument("project")
    p.add_argument("version", type=lambda v: int(v.lstrip("v")))
    p.add_argument("--dataset", help="compare on this dataset version only")
    p.add_argument("--force", action="store_true")
    p.add_argument("--reason")
    p = md.add_parser("rollback")
    p.add_argument("project")
    p.add_argument("--reason")
    p = md.add_parser("history")
    p.add_argument("project")
    return parser


def dataset_command(args) -> int:
    from . import datasets

    if args.action == "add":
        r = datasets.add_version(args.name, args.folder, args.license, args.source, args.format, args.description,
                                 parse_splits(args.split), args.note, link=not args.copy)
        if r["unchanged"]:
            print(f"{r['name']}@v{r['version']} unchanged")
        else:
            print(f"{r['name']}@v{r['version']}: {r['files']} files "
                  f"({r['linked']} linked, {r['copied']} copied, {r['existing']} already stored)")
        if r.get("linked"):
            print("linked source files are now read-only, they share storage with the registry (use --copy to avoid)")
    elif args.action == "list":
        rows = [{**r, "version": f"v{r['version']}", "size": human_size(r["bytes"]),
                 "created": r["created_at"].astimezone().strftime("%Y-%m-%d %H:%M")} for r in datasets.list_datasets()]
        table(rows, ["name", "version", "versions", "files", "size", "license", "format", "created"])
    elif args.action == "show":
        v = datasets.get_version(args.ref)
        print(f"{v['name']}@v{v['version']}  {v['files']} files, {human_size(v['bytes'])}")
        for key in ("license", "source", "format", "description", "note"):
            if v.get(key):
                print(f"{key}: {v[key]}")
        print(f"manifest: {v['manifest_hash']}")
        for name, s in v["splits"].items():
            print(f"split {name}: {s['path']}/ ({s['files']} files)")
        used = datasets.usage(args.ref)
        print(f"used by {len(used)} runs")
        table([{**u, "run": u["run_id"][:12]} for u in used], ["run", "project", "entrypoint", "mount"])
    elif args.action == "diff":
        d = datasets.diff(args.a, args.b)
        for kind, sign in (("added", "+"), ("removed", "-"), ("modified", "~")):
            for path in d[kind]:
                print(f"{sign} {path}")
        print(", ".join(f"{len(d[k])} {k}" for k in d))
    elif args.action == "verify":
        bad = datasets.verify(args.ref)
        for path in bad:
            print(f"corrupt: {path}")
        print("ok" if not bad else f"{len(bad)} corrupt files")
        return 1 if bad else 0
    return 0


def _follow(project: str) -> None:
    from . import deploy

    st = deploy.follow_production(project)
    if st:
        print(f"service redeployed with v{st['version']}")


def model_command(args) -> int:
    from . import datasets, models

    if args.action == "list":
        rows = []
        primary = models._contract(args.project)["metrics"]["primary"]
        for v in models.list_versions(args.project):
            evals = "; ".join(f"{ds}: {primary}={m[primary]:g}" if primary in m else f"{ds}: no {primary}"
                              for ds, m in v["evaluations"].items())
            rows.append({"version": f"v{v['version']}", "status": v["status"],
                         "trained_on": ", ".join(v["trained_on"]), "evaluations": evals})
        table(rows, ["version", "status", "trained_on", "evaluations"])
    elif args.action == "import":
        from pathlib import Path

        from .run import save_project

        project = load_project(args.project)
        save_project(project)
        ids = [datasets.get_version(r)["id"] for r in args.dataset]
        path = Path(args.path) if Path(args.path).is_absolute() else project.root / args.path
        metrics = (Path(args.metrics) if Path(args.metrics).is_absolute() else project.root / args.metrics) if args.metrics else None
        version = models.import_model(project.name, path, ids, metrics, args.note)
        print(f"registered {project.name}@v{version} (candidate) from {path.name}")
    elif args.action == "promote":
        dv = datasets.get_version(args.dataset)["id"] if args.dataset else None
        detail = models.promote(args.project, args.version, dv, args.force, args.reason)
        print(f"{args.project}@v{args.version} in production ({detail})")
        _follow(args.project)
    elif args.action == "rollback":
        version = models.rollback(args.project, args.reason)
        print(f"{args.project}@v{version} back in production")
        _follow(args.project)
    elif args.action == "history":
        rows = [{**e, "from": f"v{e['from_version']}" if e["from_version"] else "", "to": f"v{e['to_version']}",
                 "at": e["created_at"].astimezone().strftime("%Y-%m-%d %H:%M")} for e in models.history(args.project)]
        table(rows, ["at", "action", "from", "to", "forced", "reason"])
    return 0


def serve_command(args) -> int:
    from . import deploy

    if args.action == "start":
        st = deploy.start(args.project, args.version, args.profile)
        print(f"{args.project}@v{st['version']} serving on http://127.0.0.1:{st['port']}")
    elif args.action == "stop":
        deploy.stop(args.project)
        print(f"{args.project} stopped")
    elif args.action == "status":
        st = deploy.status(args.project)
        if "version" not in st:
            print(f"{args.project}: not deployed")
        else:
            print(f"{args.project}@v{st['version']}: {st['state']}, {'healthy' if st['healthy'] else 'unhealthy'}, "
                  f"port {st['port']}, profile {st['profile']}, since {st['started_at'][:19]}")
    elif args.action == "logs":
        print(deploy.logs(args.project), end="")
    return 0


def main(argv=None) -> int:
    os.environ.setdefault("MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT", "1")
    import mlflow  # noqa: F401  configures its loggers on import

    logging.getLogger("mlflow").setLevel(logging.WARNING)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "dataset":
            return dataset_command(args)
        if args.cmd == "model":
            return model_command(args)
        if args.cmd == "serve":
            return serve_command(args)
        if args.cmd == "api":
            import uvicorn

            uvicorn.run("mlops.api:app", host=args.host, port=args.port, reload=args.reload)
            return 0
        project = load_project(args.project)
        if args.cmd == "validate":
            print(f"{project.name}: ok ({', '.join(project.entrypoints)})")
            return 0
        from .run import run_entrypoint

        values = {"model": args.model, "split": args.split, "sample": args.sample}
        return run_entrypoint(project, args.entrypoint, args.profile, args.config, values, args.dataset)
    except ContractError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
