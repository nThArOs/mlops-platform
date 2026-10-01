# Spec

| # | Module | Purpose | Details | Components (license) | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Project contract | Plug in any model | `project.yaml`: image, datasets, several models per project with their own image, `train` / `evaluate` / `serve` / `benchmark`, JSON metrics, promotion rule | in-house | done, `benchmark` and `constraints` not used yet |
| 2 | Infrastructure | Local base | Docker Compose, CPU, portable to Kubernetes | Docker, PostgreSQL (PostgreSQL) | done locally |
| 3 | Execution | Run jobs | `mlops run`, job queue with one worker, trainings with config overrides and automatic evaluation, cancel | in-house | done |
| 4 | Run tracking | Training history | Params, metrics, artifacts, hardware, Git commit | MLflow (Apache-2.0) | done |
| 5 | Datasets | Versioned data | Content-addressed store, hard links or copies, versions, splits, license, diff, archive; dataset -> run -> model lineage | in-house, PostgreSQL | done, stats not computed |
| 6 | Model registry | Model versions | candidate -> production -> archived, variants, import of existing models, configurable promotion rule, rollback, history | MLflow Registry, PostgreSQL | done |
| 7 | Example project | Validate the contract | `compressed-detection`: residual and RGB models, live detection service | - | done, `benchmark.py` missing |
| 8 | Evaluation views | Understand a version | Watched metrics with intervals, confusion matrix with computed scores, operational metrics, threshold curve, slices | in-house | done |
| 9 | Live: training | Live curves | Loss / mAP per epoch, ETA, CPU/RAM | MLflow, `mlops_sdk` | log only |
| 10 | Live: operations | Service health | Latency, fps, errors, per-stage time, CPU/RAM; start, stop and replace the production service; live view | Prometheus (Apache-2.0), `/metrics` | done, CPU/RAM missing |
| 11 | Live: production quality | Drift without labels | Confidence distribution, predictions per input, input drift | PostgreSQL, in-house | trends only, no drift score |
| 12 | Live: true performance | Quality with labels | Precision, recall, HOTA on fresh labeled data; operator feedback endpoint | PostgreSQL, in-house | to do |
| 13 | Edge: benchmark | Embedded metrics | Latency p50/p95/p99, cold start, per-stage latency, peak RAM, size, params, FLOPs, energy | generic ONNX script, project `benchmark` | to do |
| 14 | Edge: hardware profiles | Where to measure | `local`, Docker-limited (estimated); device agent later | Docker | profiles done, agent to do |
| 15 | Edge: exports | Compare variants | ONNX, ONNX INT8, OpenVINO, exported by the project | ONNX Runtime (MIT), OpenVINO (Apache-2.0) | to do |
| 16 | Web UI | Overview | Datasets, models, runs, production pages; accuracy / latency per profile and constraint badges later | FastAPI (MIT), React (MIT), no Grafana | done for steps 1-4 |
| 17 | Retraining | Automation | Triggers: new dataset version, drift, metric drop, schedule -> run -> compare -> promote | in-house worker | manual trigger only |
| 18 | Alerts | Notify | Thresholds on drift, latency, metrics | Prometheus Alertmanager (Apache-2.0) | to do |

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
