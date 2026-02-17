import { buildApp } from "./app.js";
import { loadEnv } from "./security/env.js";

async function start() {
  const env = loadEnv();
  const app = buildApp(env);

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
