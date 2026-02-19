import { loadRunnerEnv } from "./env.js";
import { createRuntimeWorker } from "./worker.js";

async function start(): Promise<void> {
  const env = loadRunnerEnv();
  const runtimeWorker = createRuntimeWorker(env);

  const shutdown = async (signal: NodeJS.Signals) => {
    runtimeWorker.log.info({ signal }, "runner shutdown started");
    await runtimeWorker.close();
    runtimeWorker.log.info({ signal }, "runner shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void start();
