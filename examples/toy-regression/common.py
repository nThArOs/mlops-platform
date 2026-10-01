import csv
import os
import platform
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
