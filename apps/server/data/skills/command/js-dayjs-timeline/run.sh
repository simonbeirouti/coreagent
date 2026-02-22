#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:node is required for coreagent.js.dayjs_timeline" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:npm is required for coreagent.js.dayjs_timeline" >&2
  exit 1
fi

DEPS_DIR="/tmp/coreagent_jsdeps_dayjs"
mkdir -p "$DEPS_DIR"
export npm_config_cache="/tmp/coreagent_npm_cache"
npm install --quiet --no-audit --no-fund --no-save --prefix "$DEPS_DIR" dayjs

NODE_PATH="$DEPS_DIR/node_modules${NODE_PATH:+:$NODE_PATH}" node <<'JS'
const fs = require("node:fs");
const dayjs = require("dayjs");

let payload = {};
if (fs.existsSync("/workspace/input.json")) {
  payload = JSON.parse(fs.readFileSync("/workspace/input.json", "utf8"));
}

const messageContext = payload.messageContext && typeof payload.messageContext === "object"
  ? payload.messageContext
  : {};
const userMessage = typeof messageContext.userMessage === "string" ? messageContext.userMessage : "";
const attachmentContext = Array.isArray(payload.attachmentContent) ? payload.attachmentContent : [];
const attachmentText = attachmentContext
  .map((item) => {
    if (!item || typeof item !== "object") return "";
    const excerpt = typeof item.contentExcerpt === "string" ? item.contentExcerpt : "";
    const summary = typeof item.summary === "string" ? item.summary : "";
    return `${excerpt}\n${summary}`.trim();
  })
  .filter((value) => value.length > 0)
  .join("\n");

let offsets = Array.isArray(payload.offsetDays) && payload.offsetDays.length > 0
  ? payload.offsetDays.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  : [];
if (offsets.length === 0 && userMessage.length > 0) {
  const inferred = [...userMessage.matchAll(/-?\d+/g)].map((match) => Number(match[0]));
  offsets = inferred.filter((value) => Number.isFinite(value));
}
if (offsets.length === 0) {
  throw new Error("VALIDATION_ERROR:missing offsetDays and no numeric offsets found in messageContext.userMessage");
}

const dateFromInput = typeof payload.baseDate === "string" ? payload.baseDate : null;
const dateFromMessage = userMessage.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
const dateFromAttachments = attachmentText.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
const resolvedBaseDate = dateFromInput ?? dateFromMessage ?? dateFromAttachments;
if (!resolvedBaseDate) {
  throw new Error("VALIDATION_ERROR:missing baseDate and no YYYY-MM-DD date found in messageContext.userMessage or attachmentContent");
}
const baseDate = dayjs(resolvedBaseDate);
if (!baseDate.isValid()) {
  throw new Error("VALIDATION_ERROR:invalid baseDate");
}
const timeline = offsets.map((offset) => ({
  offsetDays: offset,
  date: baseDate.add(offset, "day").format("YYYY-MM-DD")
}));

const result = {
  timeline,
  generatedAt: dayjs().toISOString(),
  note: "Generated from runtime-provided message/file context."
};

process.stdout.write(JSON.stringify(result));
JS
