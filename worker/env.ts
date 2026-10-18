// Loaded first by worker/index.ts: local .env files for development.
// On Railway the variables are injected and these files do not exist.
for (const file of ['.env.local', '.env']) {
  try { process.loadEnvFile(file) } catch { /* optional */ }
}
