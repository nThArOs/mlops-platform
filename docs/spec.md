# Spec

| # | Module | Purpose | Details | Components (license) | Step |
| --- | --- | --- | --- | --- | --- |
| 1 | Project contract | Plug in any model | `project.yaml`: image, datasets, `train` / `evaluate` / `serve` / `benchmark`, JSON metrics, constraints | in-house | 1 |
| 2 | Infrastructure | Local base | Docker Compose, CPU, portable to Kubernetes | Docker, PostgreSQL (PostgreSQL) | 1 |
| 3 | Execution | Run jobs | `mlops run <project> <entrypoint>`: start container, collect outputs, log run | in-house | 2 |
| 4 | Run tracking | Training history | Params, metrics, artifacts, hardware, Git commit | MLflow (Apache-2.0) | 2 |
| 5 | Datasets | Versioned data | Content-addressed store with hard links, name, version, splits, license, stats; dataset -> run -> model lineage | in-house, PostgreSQL | 3 |
| 6 | Model registry | Model versions | candidate -> production -> archived; promotion rule on the same dataset version; rollback and history | MLflow Registry, PostgreSQL | 3 |
| 7 | Example project | Validate the contract | `compressed-detection` with `project.yaml`, `serve.py`, `benchmark.py` | - | 4 |
| 8 | Live: training | Live curves | Loss / mAP per epoch, ETA, CPU/RAM | MLflow, `mlops_sdk` | 5 |
| 9 | Live: operations | Service health | Latency, fps, errors, CPU/RAM; start, stop and replace the production service | Prometheus (Apache-2.0), `/metrics` | 3 |
| 10 | Live: production quality | Drift without labels | Confidence distribution, predictions per input, input drift | PostgreSQL, in-house | 3 |
| 11 | Live: true performance | Quality with labels | Precision, recall, HOTA on fresh labeled data; operator feedback endpoint | PostgreSQL, in-house | 5 |
| 12 | Edge: benchmark | Embedded metrics | Latency p50/p95/p99, cold start, per-stage latency, peak RAM, size, params, FLOPs, energy | generic ONNX script, project `benchmark` | 5 |
| 13 | Edge: hardware profiles | Where to measure | `local`, Docker-limited (estimated); device agent later | Docker | 5 |
| 14 | Edge: exports | Compare variants | ONNX, ONNX INT8, OpenVINO, exported by the project | ONNX Runtime (MIT), OpenVINO (Apache-2.0) | 5 |
| 15 | Web UI | Overview | Datasets, models and production pages (step 3); runs, accuracy / latency per profile, constraint badges (step 5) | FastAPI (MIT), React (MIT), no Grafana | 3, 5 |
| 16 | Retraining | Automation | Triggers: new dataset version, drift, metric drop, schedule -> run -> compare -> promote if better and within constraints | Prefect (Apache-2.0) | 6 |
| 17 | Alerts | Notify | Thresholds on drift, latency, metrics | Prometheus Alertmanager (Apache-2.0) | 6 |

## Licensing

| Item | Risk | Decision |
| --- | --- | --- |
| Ultralytics YOLO | AGPL-3.0 | Example project only, never in the platform |
| Grafana | AGPL-3.0 | Not used; charts built into the UI |
| MinIO | AGPL-3.0 | Not used; local volume or S3-compatible storage |
| VisDrone, UAVDT | Research only | Development only; demos use DUT Anti-UAV (Apache-2.0) |
| Docker-limited profiles | Approximation | Results marked estimated; only device agent results are measured |

## Step 3

| Part | Content |
| --- | --- |
| 3a | Dataset store, PostgreSQL schema, lineage, model registry, CLI |
| 3b | FastAPI service |
| 3c | Production: start, stop and replace the serve container, Prometheus discovery |
| 3d | UI: style, navigation, datasets pages |
| 3e | UI: models and production pages, live charts |
