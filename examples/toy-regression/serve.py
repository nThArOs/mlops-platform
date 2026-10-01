import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--port", type=int, default=8000)
args = parser.parse_args()
model = json.loads(Path(args.model).read_text())

LATENCY = Histogram("inference_latency_seconds", "Inference latency",
                    buckets=(0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25))
REQUESTS = Counter("inference_requests_total", "Inference requests")
ERRORS = Counter("inference_errors_total", "Failed inference requests")
PER_INPUT = Histogram("predictions_per_input", "Values predicted per request", buckets=(1, 2, 5, 10, 20, 50, 100))


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/metrics":
            return self.reply(200, generate_latest(), CONTENT_TYPE_LATEST)
        if self.path == "/health":
            return self.reply(200, {"status": "ok"})
        self.reply(404, {"detail": "not found"})

    def do_POST(self):
        if self.path != "/predict":
            return self.reply(404, {"detail": "not found"})
        REQUESTS.inc()
        start = time.perf_counter()
        try:
            xs = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))["x"]
            ys = [model["w"] * float(x) + model["b"] for x in xs]
        except (ValueError, KeyError, TypeError) as e:
            ERRORS.inc()
            return self.reply(400, {"detail": str(e)})
        LATENCY.observe(time.perf_counter() - start)
        PER_INPUT.observe(len(ys))
        self.reply(200, {"y": ys})

    def log_message(self, *_):
        pass


print(f"serving {args.model} on :{args.port}", flush=True)
ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
