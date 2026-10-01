import argparse
import json
import time
from pathlib import Path

import yaml

from common import hardware, make_data, scores

parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
cfg = yaml.safe_load(Path(parser.parse_args().config).read_text())

xs, ys = make_data(cfg["samples"], cfg["noise"], cfg["seed"])
split = int(0.8 * len(xs))
w, b = 0.0, 0.0
start = time.time()
for epoch in range(cfg["epochs"]):
    n = split
    gw = sum(2 * (w * x + b - y) * x for x, y in zip(xs[:n], ys[:n])) / n
    gb = sum(2 * (w * x + b - y) for x, y in zip(xs[:n], ys[:n])) / n
    w -= cfg["lr"] * gw
    b -= cfg["lr"] * gb
    if epoch % 10 == 0 or epoch == cfg["epochs"] - 1:
        print(f"epoch {epoch} val_rmse {scores(w, b, xs[split:], ys[split:])['rmse']}")

Path("models").mkdir(exist_ok=True)
Path("results").mkdir(exist_ok=True)
Path("models/model.json").write_text(json.dumps({"w": w, "b": b}))
result = {"val": scores(w, b, xs[split:], ys[split:]), "train_s": round(time.time() - start, 3), "hardware": hardware()}
Path("results/train.json").write_text(json.dumps(result, indent=2))
