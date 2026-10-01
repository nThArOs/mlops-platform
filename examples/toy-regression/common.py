import os
import platform
import random

TRUE_W, TRUE_B = 2.5, -1.0


def make_data(n, noise, seed):
    rng = random.Random(seed)
    xs = [rng.uniform(-3, 3) for _ in range(n)]
    ys = [TRUE_W * x + TRUE_B + rng.gauss(0, noise) for x in xs]
    return xs, ys


def scores(w, b, xs, ys):
    preds = [w * x + b for x in xs]
    mse = sum((p - y) ** 2 for p, y in zip(preds, ys)) / len(ys)
    mean = sum(ys) / len(ys)
    var = sum((y - mean) ** 2 for y in ys) / len(ys)
    return {"rmse": round(mse ** 0.5, 5), "r2": round(1 - mse / var, 5)}


def hardware():
    return {"platform": platform.platform(), "cpu": platform.machine(), "cpu_count": os.cpu_count(),
            "profile": os.environ.get("MLOPS_PROFILE")}
