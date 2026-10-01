import argparse
import csv
import random
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("out")
parser.add_argument("--samples", type=int, default=2000)
parser.add_argument("--noise", type=float, default=0.3)
parser.add_argument("--seed", type=int, default=0)
args = parser.parse_args()

rng = random.Random(args.seed)
rows = [(x, 2.5 * x - 1.0 + rng.gauss(0, args.noise)) for x in (rng.uniform(-3, 3) for _ in range(args.samples))]
split = int(0.8 * len(rows))
for name, part in (("train", rows[:split]), ("test", rows[split:])):
    path = Path(args.out) / name / "data.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows([("x", "y"), *part])
