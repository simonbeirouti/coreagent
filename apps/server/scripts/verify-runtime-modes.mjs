import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadDotenv } from "dotenv";

function hydrateEnvFromDotenvFiles() {
  const cwd = process.cwd();
  const serverEnvPath = path.resolve(cwd, ".env");
  if (existsSync(serverEnvPath)) {
    loadDotenv({ path: serverEnvPath, override: false });
  }
}

hydrateEnvFromDotenvFiles();

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function parseJsonInput(value) {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must parse to a JSON object.");
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function typeTag(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function outputSignature(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: typeTag(value) };
  }
  const entries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => [key, typeTag(v)]);
  return {
    kind: "object",
    keys: entries.map(([key]) => key),
    valueTypes: Object.fromEntries(entries),
  };
}

async function requestJson(baseUrl, pathname, token, init = {}) {
  const headers = {
    "content-type": "application/json",
    ...(init.headers ?? {}),
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}) ${init.method ?? "GET"} ${pathname}: ${body.message ?? JSON.stringify(body)}`,
    );
  }
  return body;
}

async function createRuntimeRun(baseUrl, token, payload, mode) {
  const body = await requestJson(baseUrl, "/v1/runtime/runs", token, {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      executionMode: mode,
    }),
  });
  const run = body?.data;
  if (!run?.runId) {
    throw new Error(`Create run response missing runId for mode ${mode}.`);
  }
  return run;
}

async function getRuntimeRun(baseUrl, token, runId) {
  const body = await requestJson(baseUrl, `/v1/runtime/runs/${runId}`, token);
  if (!body?.data?.runId) {
    throw new Error(`Runtime run response missing data for runId=${runId}.`);
  }
  return body.data;
}

async function pollRunUntilTerminal(baseUrl, token, runId, pollIntervalMs, maxPolls) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    const run = await getRuntimeRun(baseUrl, token, runId);
    last = run;
    if (TERMINAL_STATUSES.has(run.status)) {
      return run;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `Run ${runId} did not reach terminal status in ${maxPolls} polls (last=${last?.status ?? "unknown"}).`,
  );
}

async function listAllRunEvents(baseUrl, token, runId) {
  let cursor = 0;
  const events = [];
  for (;;) {
    const body = await requestJson(baseUrl, `/v1/runtime/runs/${runId}/events?cursor=${cursor}&limit=200`, token);
    const pageEvents = Array.isArray(body?.data) ? body.data : [];
    events.push(...pageEvents);
    const hasMore = Boolean(body?.page?.hasMore);
    if (!hasMore) {
      break;
    }
    const nextCursor = body?.page?.nextCursor;
    const parsedNext = Number.parseInt(String(nextCursor ?? ""), 10);
    cursor = Number.isFinite(parsedNext) ? parsedNext : cursor + pageEvents.length;
  }
  return events;
}

function eventSummary(events) {
  const typeCounts = new Map();
  const stateTransitions = [];
  for (const event of events) {
    const type = String(event?.type ?? "unknown");
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (type === "state_transition" && typeof event?.status === "string") {
      stateTransitions.push(event.status);
    }
  }
  return {
    total: events.length,
    logCount: typeCounts.get("log") ?? 0,
    stateTransitions,
    typeCounts: Object.fromEntries([...typeCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function assertParity(remoteRun, localRun, remoteEvents, localEvents) {
  if (remoteRun.status !== "succeeded") {
    throw new Error(`Remote run did not succeed (status=${remoteRun.status}).`);
  }
  if (localRun.status !== "succeeded") {
    throw new Error(`Local Docker run did not succeed (status=${localRun.status}).`);
  }
  if (remoteRun.error || localRun.error) {
    throw new Error("One or both runs reported a runtime error payload.");
  }

  const remoteOutputSig = outputSignature(remoteRun.output);
  const localOutputSig = outputSignature(localRun.output);
  if (JSON.stringify(remoteOutputSig) !== JSON.stringify(localOutputSig)) {
    throw new Error(
      `Output shape mismatch.\nremote=${JSON.stringify(remoteOutputSig)}\nlocal_docker=${JSON.stringify(localOutputSig)}`,
    );
  }

  const remoteEventSummary = eventSummary(remoteEvents);
  const localEventSummary = eventSummary(localEvents);
  for (const status of ["queued", "succeeded"]) {
    if (!remoteEventSummary.stateTransitions.includes(status)) {
      throw new Error(`Remote events missing state_transition=${status}.`);
    }
    if (!localEventSummary.stateTransitions.includes(status)) {
      throw new Error(`Local Docker events missing state_transition=${status}.`);
    }
  }
  if (remoteEventSummary.logCount < 1 || localEventSummary.logCount < 1) {
    throw new Error(
      `Expected log events in both modes (remote=${remoteEventSummary.logCount}, local_docker=${localEventSummary.logCount}).`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl ?? process.env.SKILLS_REGISTRY_BASE_URL ?? "http://127.0.0.1:4010");
  const token = args.authToken ?? process.env.RUNTIME_VERIFY_AUTH_TOKEN ?? process.env.COREAGENT_ACCESS_TOKEN;
  const skillId = args.skillId ?? "coreagent.rs.regex_advisor";
  const version = args.version ?? "1.0.0";
  const timeoutSeconds = Number.parseInt(args.timeoutSeconds ?? "120", 10);
  const pollIntervalMs = Number.parseInt(args.pollIntervalMs ?? "1000", 10);
  const maxPolls = Number.parseInt(args.maxPolls ?? "240", 10);
  const input = parseJsonInput(args.input ?? process.env.RUNTIME_VERIFY_INPUT_JSON);

  if (!token) {
    throw new Error(
      "Missing auth token. Pass --authToken <token> or set RUNTIME_VERIFY_AUTH_TOKEN.",
    );
  }

  if ((process.env.ENABLE_RUNTIME_QUEUE ?? "").toLowerCase() !== "true") {
    console.warn("Warning: ENABLE_RUNTIME_QUEUE is not true in current environment.");
  }

  const payload = {
    skillId,
    version,
    input,
    timeoutSeconds,
  };

  console.log(`Running parity check against ${baseUrl}`);
  console.log(`Skill: ${skillId}@${version}`);
  console.log("Creating remote runtime run...");
  const remoteCreated = await createRuntimeRun(baseUrl, token, payload, "remote");
  console.log(`Remote run created: ${remoteCreated.runId}`);

  console.log("Creating local_docker runtime run...");
  const localCreated = await createRuntimeRun(baseUrl, token, payload, "local_docker");
  console.log(`Local Docker run created: ${localCreated.runId}`);

  const [remoteRun, localRun] = await Promise.all([
    pollRunUntilTerminal(baseUrl, token, remoteCreated.runId, pollIntervalMs, maxPolls),
    pollRunUntilTerminal(baseUrl, token, localCreated.runId, pollIntervalMs, maxPolls),
  ]);

  const [remoteEvents, localEvents] = await Promise.all([
    listAllRunEvents(baseUrl, token, remoteRun.runId),
    listAllRunEvents(baseUrl, token, localRun.runId),
  ]);

  assertParity(remoteRun, localRun, remoteEvents, localEvents);

  console.log("Parity verification passed.");
  console.log(
    JSON.stringify(
      {
        remote: {
          runId: remoteRun.runId,
          status: remoteRun.status,
          outputSignature: outputSignature(remoteRun.output),
          events: eventSummary(remoteEvents),
        },
        local_docker: {
          runId: localRun.runId,
          status: localRun.status,
          outputSignature: outputSignature(localRun.output),
          events: eventSummary(localEvents),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
