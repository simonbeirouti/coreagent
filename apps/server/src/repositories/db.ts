import { Pool } from "pg";

import type { AppEnv } from "../security/env.js";

export function createDbPool(env: AppEnv): Pool | null {
  if (!env.DATABASE_URL) {
    return null;
  }

  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: env.DATABASE_POOL_MAX
  });
}
