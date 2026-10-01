# Spec

| # | Module | Purpose | Details | Components (license) | Step |
| --- | --- | --- | --- | --- | --- |
| 1 | Project contract | Plug in any model | `project.yaml`: image, datasets, `train` / `evaluate` / `serve` / `benchmark`, JSON metrics, constraints | in-house | 1 |
| 2 | Infrastructure | Local base | Docker Compose, CPU, portable to Kubernetes | Docker, PostgreSQL (PostgreSQL) | 1 |
| 3 | Execution | Run jobs | `mlops run <project> <entrypoint>`: start container, collect outputs, log run | in-house | 2 |
| 4 | Run tracking | Training history | Params, metrics, artifacts, hardware, Git commit | MLflow (Apache-2.0) | 2 |
| 5 | Datasets | Versioned data | Name, version, splits, license, stats; dataset -> run -> model lineage | DVC (Apache-2.0) | 3 |
| 6 | Model registry | Model versions | candidate -> production -> archived; comparison on the primary metric | MLflow Registry | 3 |
| 7 | Example project | Validate the contract | `compressed-detection` with `project.yaml`, `serve.py`, `benchmark.py` | - | 4 |
| 8 | Live: training | Live curves | Loss / mAP per epoch, ETA, CPU/RAM | MLflow, `mlops_sdk` | 5 |
| 9 | Live: operations | Service health | Latency, fps, errors, CPU/RAM | Prometheus (Apache-2.0), `/metrics` | 5 |
| 10 | Live: production quality | Drift without labels | Confidence distribution, predictions per input, input drift | PostgreSQL, in-house | 5 |
| 11 | Live: true performance | Quality with labels | Precision, recall, HOTA on fresh labeled data; operator feedback endpoint | PostgreSQL, in-house | 5 |
| 12 | Edge: benchmark | Embedded metrics | Latency p50/p95/p99, cold start, per-stage latency, peak RAM, size, params, FLOPs, energy | generic ONNX script, project `benchmark` | 5 |
| 13 | Edge: hardware profiles | Where to measure | `local`, Docker-limited (estimated); device agent later | Docker | 5 |
| 14 | Edge: exports | Compare variants | ONNX, ONNX INT8, OpenVINO, exported by the project | ONNX Runtime (MIT), OpenVINO (Apache-2.0) | 5 |
| 15 | Web UI | Overview | Run comparison, lineage, live dashboard, accuracy / latency per profile, constraint badges | in-house, no Grafana | 5 |
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
