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

Datasets and models:

```bash
mlops dataset add toy data/raw/toy_v1 --license CC0-1.0 --split train=train --split test=test
mlops dataset list
mlops dataset diff toy@v1 toy@v2
mlops run examples/toy-regression train --dataset toy@v1
mlops run examples/toy-regression evaluate --model toy-regression@candidate --dataset toy@v1
mlops model list toy-regression
mlops model promote toy-regression 2
mlops model rollback toy-regression
mlops serve start toy-regression
mlops serve status toy-regression
mlops serve stop toy-regression
```

`examples/toy-regression/load.py` sends test traffic to a running service.

Dataset files are stored once by content hash in `store/`. By default they are hard-linked from the source folder, which makes the source files read-only; `--copy` keeps them editable at the cost of disk space.

## API

```bash
mlops api
```

Serves the API on http://localhost:8000/api (docs at `/api/docs`) and the web UI on http://localhost:8000 once built.

## UI

```bash
cd ui
npm install
npm run build
```

The build in `ui/dist` is served by `mlops api`. For development, `npm run dev` serves the UI on http://localhost:3000 with `/api` proxied to the API. It runs on the host, not in Docker, to read dataset folders and hard-link them into the store.

Each run is an MLflow run in the experiment named after the project: params (command, config values, profile), tags (image id, Git commit), metrics from the JSON outputs, artifacts (model, metrics, config, stdout, hardware).

Platform settings are in `configs/platform.yaml`, hardware profiles in `configs/hardware_profiles.yaml`. Docker-limited profiles are tagged `estimated`.
