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

const offsets = Array.isArray(payload.offsetDays) && payload.offsetDays.length > 0
  ? payload.offsetDays.map((value) => Number(value))
  : [0, 1, 7, 30];

const baseDate = dayjs(payload.baseDate || "2026-01-01");
const timeline = offsets.map((offset) => ({
  offsetDays: offset,
  date: baseDate.add(offset, "day").format("YYYY-MM-DD")
}));

const result = {
  timeline,
  generatedAt: dayjs().toISOString(),
  note: "Generated with dayjs installed at runtime."
};

process.stdout.write(JSON.stringify(result));
JS
