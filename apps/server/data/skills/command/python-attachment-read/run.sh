#!/bin/sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:python3 is required for coreagent.py.attachment_read" >&2
  exit 1
fi

python3 - <<'PY'
import json
from pathlib import Path

def normalize_storage_path(path):
    normalized = str(path or '').strip()
    if normalized.startswith('/'):
        normalized = normalized[1:]
    if normalized.startswith('user-files/'):
        normalized = normalized[len('user-files/'):]
    return normalized

input_path = Path('/workspace/input.json')
if input_path.exists():
    payload = json.loads(input_path.read_text(encoding='utf-8'))
else:
    payload = {}

attachments = payload.get('attachments') or []
attachment_content = payload.get('attachmentContent') or []

if not isinstance(attachments, list):
    attachments = []
if not isinstance(attachment_content, list):
    attachment_content = []

content_by_path = {}
for item in attachment_content:
    if not isinstance(item, dict):
        continue
    storage_path = str(item.get('storagePath') or '').strip()
    if not storage_path:
        continue
    content_by_path[storage_path] = item
    normalized_path = normalize_storage_path(storage_path)
    if normalized_path and normalized_path != storage_path:
        content_by_path[normalized_path] = item

results = []
for attachment in attachments:
    if not isinstance(attachment, dict):
        continue
    storage_path = str(attachment.get('storagePath') or attachment.get('path') or '').strip()
    file_name = str(attachment.get('fileName') or '').strip()
    file_type = str(attachment.get('fileType') or '').strip().lower()
    if not storage_path:
        continue

    normalized_storage_path = normalize_storage_path(storage_path)
    content_entry = content_by_path.get(storage_path) or content_by_path.get(normalized_storage_path)
    if content_entry:
        entry_status = str(content_entry.get('status') or '').strip().lower()
        entry_error = content_entry.get('error')
        excerpt = content_entry.get('contentExcerpt')
        summary = content_entry.get('summary')
        truncated = bool(content_entry.get('truncated'))
        file_type_from_content = str(content_entry.get('fileType') or '')
        normalized_status = "succeeded"
        if entry_status and entry_status != "succeeded":
            normalized_status = "failed"
        if entry_error:
            normalized_status = "failed"
        if not entry_status and summary is None and excerpt is None:
            normalized_status = "failed"

        if normalized_status == "succeeded":
            result_summary = summary or f"Read attachment context for {storage_path}."
        else:
            result_summary = summary or f"Failed to read attachment context for {storage_path}."

        results.append({
            "storagePath": storage_path,
            "fileName": file_name or storage_path.rsplit('/', 1)[-1],
            "fileType": file_type or file_type_from_content,
            "status": normalized_status,
            "summary": result_summary,
            "contentExcerpt": excerpt,
            "truncated": truncated,
            "error": entry_error
        })
    else:
        results.append({
            "storagePath": storage_path,
            "fileName": file_name or storage_path.rsplit('/', 1)[-1],
            "fileType": file_type,
            "status": "failed",
            "summary": f"No attachmentContent was provided for {storage_path}.",
            "contentExcerpt": None,
            "truncated": False,
            "error": "attachment_content_missing"
        })

if not results:
    raise SystemExit("VALIDATION_ERROR:no attachments provided")

read_count = sum(1 for item in results if item.get("status") == "succeeded")
status = "succeeded" if read_count > 0 else "failed"

output = {
    "status": status,
    "summary": f"Read {read_count} of {len(results)} attachment(s).",
    "readCount": read_count,
    "results": results
}
print(json.dumps(output))
PY
