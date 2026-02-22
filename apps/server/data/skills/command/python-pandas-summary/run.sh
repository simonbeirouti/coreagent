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
from io import StringIO
from pathlib import Path

import pandas as pd

input_path = Path('/workspace/input.json')
if input_path.exists():
    payload = json.loads(input_path.read_text(encoding='utf-8'))
else:
    payload = {}

rows = payload.get('rows') or []
if not rows:
    attachment_content = payload.get('attachmentContent') or []
    csv_text = None
    if isinstance(attachment_content, list):
        for item in attachment_content:
            if not isinstance(item, dict):
                continue
            file_type = str(item.get('fileType') or '').lower()
            excerpt = item.get('contentExcerpt')
            if file_type == 'csv' and isinstance(excerpt, str) and excerpt.strip():
                csv_text = excerpt
                break
    if csv_text:
        frame = pd.read_csv(StringIO(csv_text))
        rows = frame.to_dict(orient='records')

df = pd.DataFrame(rows)
if df.empty:
    raise SystemExit('VALIDATION_ERROR:missing rows and no parseable CSV attachment context')
if "score" not in df.columns:
    message_context = payload.get('messageContext') or {}
    if isinstance(message_context, dict):
        user_message = message_context.get('userMessage')
        if isinstance(user_message, str):
            maybe_score = pd.to_numeric(pd.Series([user_message]).str.extract(r'(-?\d+(?:\.\d+)?)')[0], errors='coerce')
            if maybe_score.notna().any():
                df["score"] = float(maybe_score.dropna().iloc[0])
            else:
                raise SystemExit('VALIDATION_ERROR:rows are missing score column and no score inferred from message context')
        else:
            raise SystemExit('VALIDATION_ERROR:rows are missing score column')
    else:
        raise SystemExit('VALIDATION_ERROR:rows are missing score column')

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
