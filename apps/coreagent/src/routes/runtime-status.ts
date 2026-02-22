export type RuntimeExecutionMode = "remote" | "local_docker";
export type RuntimeSetupState = "idle" | "checking" | "ready" | "failed";
export type RuntimeStatusTone = "neutral" | "success" | "warning" | "error";

export type RuntimeStatus = {
  tone: RuntimeStatusTone;
  text: string;
};

export function getRuntimeStatus(args: {
  mode: RuntimeExecutionMode;
  setupState: RuntimeSetupState;
  setupMessage: string | null;
}): RuntimeStatus {
  const { mode, setupState, setupMessage } = args;

  if (mode === "remote") {
    return {
      tone: "success",
      text: "Active"
    };
  }

  if (setupState === "ready") {
    return {
      tone: "success",
      text: "Active"
    };
  }

  if (setupState === "failed") {
    return {
      tone: "error",
      text: setupMessage || "Open Docker Desktop"
    };
  }

  return {
    tone: "warning",
    text: setupMessage || "Checking..."
  };
}
