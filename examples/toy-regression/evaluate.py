import argparse
import json
from pathlib import Path

from common import hardware, load, scores

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--data", required=True)
args = parser.parse_args()
model = json.loads(Path(args.model).read_text())

xs, ys = load(args.data, "test")
result = {**scores(model["w"], model["b"], xs, ys), "hardware": hardware()}
Path("results").mkdir(exist_ok=True)
Path("results/eval.json").write_text(json.dumps(result, indent=2))
print({k: v for k, v in result.items() if k != "hardware"})
