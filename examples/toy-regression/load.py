import argparse
import json
import random
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("url", help="http://127.0.0.1:<port>")
parser.add_argument("--rps", type=float, default=5)
parser.add_argument("--seconds", type=int, default=300)
parser.add_argument("--error-rate", type=float, default=0.02)
args = parser.parse_args()

end = time.time() + args.seconds
sent = failed = 0
while time.time() < end:
    xs = [random.uniform(-3, 3) for _ in range(random.randint(1, 20))]
    body = {"x": xs} if random.random() > args.error_rate else {"x": ["bad"]}
    req = urllib.request.Request(f"{args.url}/predict", json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=2).read()
    except (urllib.error.URLError, OSError):
        failed += 1
    sent += 1
    time.sleep(1 / args.rps)
print(f"{sent} requests, {failed} errors")
