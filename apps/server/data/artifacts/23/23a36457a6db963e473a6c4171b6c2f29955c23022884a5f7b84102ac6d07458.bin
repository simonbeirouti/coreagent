#!/bin/sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:python3 is required for coreagent.py.pandas_summary" >&2
  exit 1
fi

if ! python3 -m pip --version >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:pip is required for coreagent.py.pandas_summary" >&2
  exit 1
fi

DEPS_DIR="/tmp/coreagent_pydeps_pandas"
mkdir -p "$DEPS_DIR"
python3 -m pip install --quiet --disable-pip-version-check --target "$DEPS_DIR" pandas

PYTHONPATH="$DEPS_DIR${PYTHONPATH:+:$PYTHONPATH}" python3 - <<'PY'
import json
from pathlib import Path

import pandas as pd

input_path = Path('/workspace/input.json')
if input_path.exists():
    payload = json.loads(input_path.read_text(encoding='utf-8'))
else:
    payload = {}

rows = payload.get('rows') or [
    {"team": "alpha", "score": 10},
    {"team": "beta", "score": 15},
    {"team": "gamma", "score": 8},
]

df = pd.DataFrame(rows)
if "score" not in df.columns:
    df["score"] = 0

summary = {
    "count": int(len(df)),
    "mean_score": float(df["score"].mean()),
    "max_score": float(df["score"].max()),
    "min_score": float(df["score"].min()),
}

result = {
    "summary": summary,
    "top_rows": df.sort_values("score", ascending=False).head(2).to_dict(orient="records"),
    "note": "Computed via pandas installed at runtime."
}

print(json.dumps(result))
PY
