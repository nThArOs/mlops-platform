import argparse
import json
from pathlib import Path

from common import hardware, make_data, scores

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
model = json.loads(Path(parser.parse_args().model).read_text())

xs, ys = make_data(1000, 0.3, seed=42)
result = {**scores(model["w"], model["b"], xs, ys), "hardware": hardware()}
Path("results").mkdir(exist_ok=True)
Path("results/eval.json").write_text(json.dumps(result, indent=2))
print(result)
