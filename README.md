# mlops-platform

Model-agnostic MLOps platform: datasets, training runs, model registry, retraining, live monitoring and edge benchmarks. A project plugs in with a `project.yaml` ([contract](docs/contract.md)). Scope and roadmap: [spec](docs/spec.md).

## Start

```bash
docker compose up -d --build
```

| Service | URL |
| --- | --- |
| MLflow | http://localhost:5000 |
| Prometheus | http://localhost:9090 |
| PostgreSQL | localhost:5432 (`platform`, `mlflow`) |

Credentials default to `mlops` / `mlops`; override them in `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`). Services listen on localhost only.

## CLI

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e .
```

```bash
docker build -t mlops-toy-regression:cpu examples/toy-regression
mlops validate examples/toy-regression
mlops run examples/toy-regression train
mlops run examples/toy-regression evaluate --model models/model.json --profile edge-small
```

Each run is an MLflow run in the experiment named after the project: params (command, config values, profile), tags (image id, Git commit), metrics from the JSON outputs, artifacts (model, metrics, config, stdout, hardware).

Platform settings are in `configs/platform.yaml`, hardware profiles in `configs/hardware_profiles.yaml`. Docker-limited profiles are tagged `estimated`.
