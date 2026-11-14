// Test double of scripts/ingest-upload.ts: runs until told to stop. On SIGTERM
// it leaves a marker file (WORKER_MARKER) and exits, as the real worker does
// after marking its run as failed.
import { writeFileSync } from "node:fs";

process.on("SIGTERM", () => {
  if (process.env.WORKER_MARKER) {
    writeFileSync(process.env.WORKER_MARKER, "sigterm");
  }
  process.exit(0);
});
setInterval(() => {}, 1000);
