const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

const missing = required.filter((key) => {
  const value = process.env[key];
  return !value || !value.trim();
});

if (missing.length > 0) {
  console.error("Missing required core-admin env vars:");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log("core-admin env check passed.");
