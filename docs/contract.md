# Project contract

A project plugs into the platform with a `project.yaml` at its root. The platform only runs the declared commands inside the project image and reads the JSON files they write. It has no knowledge of the model framework.

## Example

```yaml
name: compressed-detection
image: compressed-detection-track:cpu
task: detection-tracking

datasets:
  - name: dut_anti_uav
    format: mot
    splits: [train, test]

entrypoints:
  train:
    command: python scripts/train_yolo.py --config {config}
    config: configs/train.yaml
    outputs: { model: models/*.pt, metrics: results/detect_*.json }
  evaluate:
    command: python scripts/eval_mot.py --model {model} --dataset {dataset}
    outputs: { metrics: results/metrics_*.json }
  benchmark:
    command: python scripts/benchmark.py --model {model} --input {sample}
    outputs: { metrics: results/bench_*.json }
  serve:
    command: python scripts/serve.py --model {model}
    port: 8000

export:
  formats: [onnx, onnx-int8, openvino]

metrics:
  primary: HOTA
  higher_is_better: true
  watch: [HOTA, MOTA, IDF1, fps]

constraints:
  edge-small: { latency_p95_ms: 100, ram_mb: 1024, model_mb: 20 }
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Unique project name |
| `image` | yes | Docker image that contains the code and its dependencies |
| `workdir` | no | Directory where the project root is mounted in the container, default `/app` |
| `shm_size` | no | Shared memory for the container, for example `2g` |
| `task` | no | Free label, display only |
| `datasets` | no | Datasets used by the project; `format` is a free label |
| `entrypoints.train` | yes | Produces a model and a metrics JSON |
| `entrypoints.evaluate` | yes | Produces a metrics JSON for a model and a dataset |
| `entrypoints.benchmark` | no | Produces latency and resource metrics; a generic ONNX benchmark is used if absent |
| `entrypoints.serve` | no | HTTP service; required for live monitoring |
| `export.formats` | no | Model variants to benchmark |
| `metrics.primary` | yes | Metric used to compare models and decide promotion |
| `metrics.higher_is_better` | yes | Direction of the primary metric |
| `metrics.watch` | no | Metrics shown on dashboards and checked by alert rules |
| `constraints` | no | Limits per hardware profile; a model that exceeds them is never promoted |

## Placeholders

The platform replaces these in `command`: `{config}`, `{model}`, `{dataset}`, `{split}`, `{sample}`, `{run_dir}`.

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

`serve` exposes Prometheus metrics on `GET /metrics`, at least:

- `inference_latency_seconds` (histogram)
- `inference_requests_total`, `inference_errors_total` (counters)
- `prediction_confidence` (histogram), `predictions_per_input` (histogram)
