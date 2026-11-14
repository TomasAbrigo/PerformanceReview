// Test double of a stuck scripts/ingest-upload.ts: SIGTERM does nothing, only
// SIGKILL stops it.
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
