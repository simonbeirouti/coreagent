#!/bin/sh
set -eu

if ! command -v cargo >/dev/null 2>&1; then
  echo "LOCAL_RUNTIME_MISSING:cargo is required for coreagent.rs.regex_advisor" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d /tmp/coreagent-rust-XXXXXX)"
mkdir -p "$WORK_DIR/src"

cat > "$WORK_DIR/Cargo.toml" <<'TOML'
[package]
name = "runtime_regex_advisor"
version = "0.1.0"
edition = "2021"

[dependencies]
regex = "1"
serde_json = "1"
TOML

cat > "$WORK_DIR/src/main.rs" <<'RUST'
use regex::Regex;
use serde_json::{json, Value};
use std::fs;

fn main() {
    let input = fs::read_to_string("/workspace/input.json").unwrap_or_else(|_| "{}".to_string());
    let payload: Value = serde_json::from_str(&input).unwrap_or_else(|_| json!({}));
    let attachment_text = payload
        .get("attachmentContent")
        .and_then(Value::as_array)
        .and_then(|items| {
            let joined = items
                .iter()
                .filter_map(|item| {
                    item.get("contentExcerpt")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("summary").and_then(Value::as_str))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if joined.trim().is_empty() {
                None
            } else {
                Some(joined)
            }
        });
    let text = payload
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .get("messageContext")
                .and_then(Value::as_object)
                .and_then(|ctx| ctx.get("userMessage"))
                .and_then(Value::as_str)
        })
        .or(attachment_text.as_deref())
        .unwrap_or("");
    if text.trim().is_empty() {
        eprintln!("VALIDATION_ERROR:missing required input text or messageContext.userMessage");
        std::process::exit(1);
    }
    let pattern = payload
        .get("pattern")
        .and_then(Value::as_str)
        .unwrap_or(r"[A-Za-z]+-\d+");
    let regex = match Regex::new(pattern) {
        Ok(value) => value,
        Err(_) => {
            eprintln!("VALIDATION_ERROR:invalid regex pattern provided");
            std::process::exit(1);
        }
    };
    let matches: Vec<String> = regex.find_iter(text).map(|m| m.as_str().to_string()).collect();

    let output = json!({
        "patternUsed": regex.as_str(),
        "matchCount": matches.len(),
        "matches": matches,
        "advisory": "Extracted regex matches from submitted runtime context (message and optional file excerpts)."
    });

    println!("{}", output);
}
RUST

cargo run --quiet --manifest-path "$WORK_DIR/Cargo.toml"
rm -rf "$WORK_DIR"
