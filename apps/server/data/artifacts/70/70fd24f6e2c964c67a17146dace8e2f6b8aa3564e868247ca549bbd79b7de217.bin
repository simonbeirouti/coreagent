#!/bin/sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:python3 is required for coreagent.py.deep_analysis" >&2
  exit 1
fi

if ! python3 -m pip --version >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:pip is required for coreagent.py.deep_analysis" >&2
  exit 1
fi

# Install analysis dependency into an isolated writable directory at execution time.
DEPS_DIR="/tmp/coreagent_pydeps"
mkdir -p "$DEPS_DIR"
python3 -m pip install --quiet --disable-pip-version-check --target "$DEPS_DIR" numpy

PYTHONPATH="$DEPS_DIR${PYTHONPATH:+:$PYTHONPATH}" python3 - <<'PY'
import json
from pathlib import Path

import numpy as np

input_path = Path('/workspace/input.json')
if input_path.exists():
    payload = json.loads(input_path.read_text(encoding='utf-8'))
else:
    payload = {}

values = payload.get('values') or []
values = [float(value) for value in values]
if not values:
    values = [1.0, 3.0, 7.0, 12.0, 18.0]

arr = np.array(values, dtype=float)
result = {
    'summary': {
        'count': int(arr.size),
        'mean': float(arr.mean()),
        'stddev': float(arr.std()),
        'min': float(arr.min()),
        'max': float(arr.max()),
        'percentile_90': float(np.percentile(arr, 90)),
    },
    'insight': 'Computed descriptive statistics via numpy installed at runtime.'
}
print(json.dumps(result))
PY
