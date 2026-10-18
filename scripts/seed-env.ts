// Loaded first by scripts/seed.ts: local env files for development runs.
for (const file of ['.env.local', '.env']) {
  try { process.loadEnvFile(file) } catch { /* optional */ }
}
