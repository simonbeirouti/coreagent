import { describe, expect, it } from "vitest";

import { getRuntimeStatus } from "./runtime-status";

describe("getRuntimeStatus", () => {
  it("returns neutral remote status", () => {
    expect(
      getRuntimeStatus({
        mode: "remote",
        setupState: "idle",
        setupMessage: null
      })
    ).toEqual({
      tone: "neutral",
      text: "Remote active"
    });
  });

  it("returns success when local docker is ready", () => {
    expect(
      getRuntimeStatus({
        mode: "local_docker",
        setupState: "ready",
        setupMessage: null
      })
    ).toEqual({
      tone: "success",
      text: "Docker is running"
    });
  });

  it("returns failure message for local docker errors", () => {
    expect(
      getRuntimeStatus({
        mode: "local_docker",
        setupState: "failed",
        setupMessage: "Open docker in background"
      })
    ).toEqual({
      tone: "error",
      text: "Open docker in background"
    });
  });
});
