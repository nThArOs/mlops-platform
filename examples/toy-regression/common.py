import csv
import json
import os
import platform
import time
import urllib.request
from pathlib import Path


def load(data_dir, split):
    with open(Path(data_dir) / split / "data.csv") as f:
        rows = list(csv.DictReader(f))
    return [float(r["x"]) for r in rows], [float(r["y"]) for r in rows]


def scores(w, b, xs, ys):
    preds = [w * x + b for x in xs]
    mse = sum((p - y) ** 2 for p, y in zip(preds, ys)) / len(ys)
    mean = sum(ys) / len(ys)
    var = sum((y - mean) ** 2 for y in ys) / len(ys)
    return {"rmse": round(mse ** 0.5, 5), "r2": round(1 - mse / var, 5)}


def hardware():
    return {"platform": platform.platform(), "cpu": platform.machine(), "cpu_count": os.cpu_count(),
            "profile": os.environ.get("MLOPS_PROFILE")}


def log_metric(key, value, step):
    """Log to the run created by the platform, if any, through the MLflow REST API."""
    uri, run_id = os.environ.get("MLFLOW_TRACKING_URI"), os.environ.get("MLFLOW_RUN_ID")
    if not uri or not run_id:
        return
    body = {"run_id": run_id, "key": key, "value": value, "step": step, "timestamp": int(time.time() * 1000)}
    req = urllib.request.Request(f"{uri}/api/2.0/mlflow/runs/log-metric", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except OSError:
        pass
