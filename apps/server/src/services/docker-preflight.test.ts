import { describe, expect, it } from "vitest";

import {
  detectRuntimeProfileFromScript,
  extractMissingRuntimeBinary,
  inferRuntimeProfileFromMissingBinary,
  normalizeExampleInput
} from "./docker-preflight.js";

describe("docker preflight runtime detection", () => {
  it("detects python from shebang", () => {
    const script = "#!/usr/bin/env python3\nprint('hello')\n";
    expect(detectRuntimeProfileFromScript(script)).toEqual({
      profile: "python",
      source: "script_shebang"
    });
  });

  it("detects rust from command heuristics", () => {
    const script = "#!/bin/sh\ncargo run --quiet\n";
    expect(detectRuntimeProfileFromScript(script)).toEqual({
      profile: "rust",
      source: "script_heuristic"
    });
  });

  it("detects node from command heuristics", () => {
    const script = "#!/bin/sh\nnode ./index.js\n";
    expect(detectRuntimeProfileFromScript(script)).toEqual({
      profile: "node",
      source: "script_heuristic"
    });
  });

  it("parses LOCAL_RUNTIME_MISSING and maps retry profile", () => {
    const stderr = "LOCAL_RUNTIME_MISSING:python3 is required for coreagent.py.deep_analysis";
    expect(extractMissingRuntimeBinary(stderr)).toBe("python3");
    expect(inferRuntimeProfileFromMissingBinary(stderr)).toEqual({
      profile: "python",
      source: "runtime_missing_retry"
    });
  });

  it("keeps JSON examples as JSON", () => {
    const normalized = normalizeExampleInput(Buffer.from('{"rows":[{"score":42}]}', "utf8"));
    expect(normalized.source).toBe("json");
    expect(normalized.fileType).toBe("json");
    expect(JSON.parse(normalized.jsonText)).toEqual({ rows: [{ score: 42 }] });
  });

  it("wraps CSV examples into attachmentContent payload", () => {
    const normalized = normalizeExampleInput(Buffer.from("name,score\nalice,91\nbob,77\n", "utf8"));
    expect(normalized.source).toBe("wrapped_attachment");
    expect(normalized.fileType).toBe("csv");
    const payload = JSON.parse(normalized.jsonText) as {
      attachmentContent?: Array<{ fileType?: string; contentExcerpt?: string }>;
    };
    expect(payload.attachmentContent?.[0]?.fileType).toBe("csv");
    expect(payload.attachmentContent?.[0]?.contentExcerpt).toContain("name,score");
  });

  it("overrides messageContext.userMessage when ai input is provided", () => {
    const normalized = normalizeExampleInput(
      Buffer.from('{"rows":[{"score":12}],"messageContext":{"userMessage":"old"}}', "utf8"),
      "new ai prompt"
    );
    const payload = JSON.parse(normalized.jsonText) as {
      messageContext?: { userMessage?: string };
    };
    expect(payload.messageContext?.userMessage).toBe("new ai prompt");
  });
});
