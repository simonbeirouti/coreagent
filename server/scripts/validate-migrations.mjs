import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const migrationsDir = join(globalThis.process.cwd(), "..", "supabase", "migrations");
const migrationPattern = /^(\d{3})_[a-z0-9_]+\.sql$/;

function fail(message) {
  globalThis.console.error(`migration validation failed: ${message}`);
  globalThis.process.exit(1);
}

const entries = await readdir(migrationsDir, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  fail(`no .sql files found in ${migrationsDir}`);
}

const seenPrefixes = new Set();
let previousPrefix = -1;

for (const file of files) {
  const match = migrationPattern.exec(file);
  if (!match) {
    fail(
      `invalid migration filename "${file}" (expected NNN_snake_case.sql with a 3-digit prefix)`
    );
  }

  const prefix = Number.parseInt(match[1], 10);
  if (seenPrefixes.has(prefix)) {
    fail(`duplicate migration prefix "${match[1]}"`);
  }
  seenPrefixes.add(prefix);

  if (prefix <= previousPrefix) {
    fail(`migration prefixes must be strictly increasing; got ${match[1]} after ${previousPrefix}`);
  }
  previousPrefix = prefix;

  const absolutePath = join(migrationsDir, file);
  const fileStats = await stat(absolutePath);
  if (fileStats.size === 0) {
    fail(`migration "${file}" is empty`);
  }
}

globalThis.console.log(`migration validation passed: ${files.length} files checked`);
