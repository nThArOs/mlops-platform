import argparse
import logging
import os
import sys

from .project import ContractError, load_project


def main(argv=None) -> int:
    os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
    os.environ.setdefault("MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT", "1")
    logging.getLogger("mlflow").setLevel(logging.WARNING)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="mlops")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_validate = sub.add_parser("validate", help="check a project.yaml")
    p_validate.add_argument("project", help="project root")

    p_run = sub.add_parser("run", help="run a project entrypoint and log it to MLflow")
    p_run.add_argument("project", help="project root")
    p_run.add_argument("entrypoint")
    p_run.add_argument("--profile", help="hardware profile from configs/hardware_profiles.yaml")
    p_run.add_argument("--config", help="config file relative to the project root")
    for name in ("model", "dataset", "split", "sample"):
        p_run.add_argument(f"--{name}")

    args = parser.parse_args(argv)
    try:
        project = load_project(args.project)
        if args.cmd == "validate":
            print(f"{project.name}: ok ({', '.join(project.entrypoints)})")
            return 0
        from .run import run_entrypoint

        values = {k: getattr(args, k) for k in ("model", "dataset", "split", "sample")}
        return run_entrypoint(project, args.entrypoint, args.profile, args.config, values)
    except ContractError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
