# Project contract

A project plugs into the platform with a `project.yaml` at its root. The platform only runs the declared commands inside the project image and reads the JSON files they write. It has no knowledge of the model framework.

## Example

The `project.yaml` of a drone detection project working on compressed video, with the planned `export` and `constraints` sections:

```yaml
name: compressed-detection
image: compressed-detection-track:cpu
task: detection-tracking
shm_size: 2g

datasets:
  - name: dut_anti_uav_mot
    mount: data/mot/dut_anti_uav
  - name: dut_anti_uav_yolo
    mount: data/yolo/dut_anti_uav

entrypoints:
  train:
    command: python scripts/train_yolo.py dut_anti_uav residual --config {config} --tag platform
    config: configs/train.yaml
    outputs: { model: models/dut_anti_uav_residual_platform.pt, metrics: results/detect_dut_anti_uav_residual_platform.json }
  evaluate:
    command: >-
      python scripts/track.py platform dut_anti_uav --input residual --model {model} --classes drone
      --sequences data/yolo/dut_anti_uav/splits.json
      && python scripts/eval_mot.py platform dut_anti_uav --sequences data/yolo/dut_anti_uav/splits.json
    outputs: { metrics: results/metrics_dut_anti_uav_test_platform_heldout.json }
  serve:
    command: python scripts/serve.py --model {model} --port {port} --input residual
    port: 8000

metrics:
  primary: mean.HOTA
  higher_is_better: true
  watch: [mean.HOTA, mean.MOTA, mean.IDF1, fps]

export:
  formats: [onnx, onnx-int8, openvino]

constraints:
  edge-small: { latency_p95_ms: 500, ram_mb: 2048, model_mb: 20 }
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Unique project name |
| `image` | yes | Docker image that contains the code and its dependencies |
| `workdir` | no | Directory where the project root is mounted in the container, default `/app` |
| `shm_size` | no | Shared memory for the container, for example `2g` |
| `task` | no | Free label, display only |
| `datasets` | no | Registry datasets the project reads; `mount` is where a version is mounted read-only, relative to the project root |
| `entrypoints.train` | yes | Produces a model and a metrics JSON |
| `entrypoints.evaluate` | yes | Produces a metrics JSON for a model and a dataset |
| `entrypoints.benchmark` | no | Produces latency and resource metrics; a generic ONNX benchmark is used if absent |
| `entrypoints.serve` | no | HTTP service; required for live monitoring |
| `export.formats` | no | Model variants to benchmark |
| `metrics.primary` | yes | Metric used to compare models and decide promotion, as a flattened key: `mean.HOTA` for a `HOTA` value inside a `mean` object |
| `metrics.higher_is_better` | yes | Direction of the primary metric |
| `metrics.watch` | no | Metrics shown on dashboards and checked by alert rules |
| `constraints` | no | Limits per hardware profile; a model that exceeds them is never promoted |

## Placeholders

The platform replaces these in `command`:

| Placeholder | Value |
| --- | --- |
| `{config}` | Entrypoint config, or `--config` |
| `{model}` | `--model`: a path in the project, or the downloaded registry model for `project@vN` / `project@alias` |
| `{dataset}`, `{dataset_path}` | Name and mount path of the dataset, when one `--dataset` is given |
| `{split}`, `{sample}` | Values passed on the command line |
| `{port}` | Container port of `serve` |
| `{run_dir}` | Per-run scratch directory |

## Datasets and models

- `--dataset name@vN` mounts that registry version read-only at its `mount`; without `@vN` the latest version is used. The run is linked to the version (lineage).
- A successful run with a `model` output registers a new model version named after the project, with the `candidate` alias.
- An `evaluate` run on a registry model with a dataset records the metrics on that model version for that dataset version.
- Promotion to `production` requires the primary metric to be better than the current production version on a dataset version both were evaluated on. `--force` bypasses the check and requires a reason. Every change is kept in the history.

## Execution

The command runs with `sh -c` in the project image, with the project root mounted at `workdir`, which is also the current directory. CPU and memory limits come from the hardware profile. The container receives:

| Variable | Value |
| --- | --- |
| `MLFLOW_TRACKING_URI` | Tracking server reachable from the container |
| `MLFLOW_RUN_ID` | Run created by the platform, for live logging |
| `MLOPS_RUN_DIR` | Per-run scratch directory, `/mlops/run`, logged as artifacts |
| `MLOPS_PROFILE` | Hardware profile name |

## Outputs

- `outputs` values are glob patterns relative to the project root. Only files written during the run are collected.
- `metrics` files are logged as metrics; any other key (`model`, ...) is logged as artifacts under that name.
- Metrics files are flat or nested JSON. Numeric leaves are logged; a `hardware` object, if present, is stored with the run.

## Benchmark JSON

```json
{
  "model": "models/dut_anti_uav_residual.onnx",
  "format": "onnx",
  "profile": "edge-small",
  "measured": false,
  "latency_ms": { "p50": 0, "p95": 0, "p99": 0, "cold_start": 0 },
  "stages_ms": { "decode": 0, "preprocess": 0, "inference": 0, "postprocess": 0, "tracking": 0 },
  "fps": 0,
  "ram_peak_mb": 0,
  "cpu_pct": 0,
  "model_mb": 0,
  "params": 0,
  "flops": 0,
  "hardware": {}
}
```

`stages_ms` keys are free. `measured` is `true` only on a real device; Docker-limited profiles give `false` (estimated).

## Serve

`mlops serve start <project>` runs `serve` with the production model mounted read-only (`{model}`) and `{port}` set to the declared port, published on `127.0.0.1` with a port kept across redeployments. Promotion and rollback redeploy a running service. Prometheus scrapes it through file discovery, with `project` and `version` labels.

The service exposes Prometheus metrics on `GET /metrics`:

| Metric | Type | Required |
| --- | --- | --- |
| `inference_latency_seconds` | histogram | yes |
| `inference_requests_total`, `inference_errors_total` | counter | yes |
| `predictions_per_input` | histogram | no |
| `prediction_confidence` | histogram | no |
