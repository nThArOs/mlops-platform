import argparse
import json
import time
from pathlib import Path

import yaml

from common import hardware, load, log_metric, scores

parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
parser.add_argument("--data", required=True)
args = parser.parse_args()
cfg = yaml.safe_load(Path(args.config).read_text())

xs, ys = load(args.data, "train")
split = int(0.9 * len(xs))
w, b = 0.0, 0.0
start = time.time()
for epoch in range(cfg["epochs"]):
    gw = sum(2 * (w * x + b - y) * x for x, y in zip(xs[:split], ys[:split])) / split
    gb = sum(2 * (w * x + b - y) for x, y in zip(xs[:split], ys[:split])) / split
    w -= cfg["lr"] * gw
    b -= cfg["lr"] * gb
    val = scores(w, b, xs[split:], ys[split:])
    if epoch % 5 == 0 or epoch == cfg["epochs"] - 1:
        log_metric("val/rmse", val["rmse"], epoch)
        log_metric("train/rmse", scores(w, b, xs[:split], ys[:split])["rmse"], epoch)
    if epoch % 10 == 0 or epoch == cfg["epochs"] - 1:
        print(f"epoch {epoch} val_rmse {val['rmse']}")

Path("models").mkdir(exist_ok=True)
Path("results").mkdir(exist_ok=True)
Path("models/model.json").write_text(json.dumps({"w": w, "b": b}))
result = {"val": scores(w, b, xs[split:], ys[split:]), "train_s": round(time.time() - start, 3), "hardware": hardware()}
Path("results/train.json").write_text(json.dumps(result, indent=2))
