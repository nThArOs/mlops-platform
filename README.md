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

Hardware profiles for benchmarks are in `configs/hardware_profiles.yaml`.
