/* eslint-disable no-console */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { processJob } from "../src/lib/jobs/dispatcher";
import { autoShutdownIfIdle } from "../src/lib/gpu-manager";

const POLL_INTERVAL_MS = 4_000;
const IDLE_CHECK_INTERVAL_MS = 60_000;

let stopping = false;

async function pickNextJobId(): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return job?.id ?? null;
}

async function loop() {
  let lastIdleCheck = 0;
  while (!stopping) {
    try {
      const id = await pickNextJobId();
      if (id) {
        console.log(`[worker] processing job ${id}`);
        try {
          await processJob(id);
          console.log(`[worker] finished job ${id}`);
        } catch (err) {
          console.error(`[worker] job ${id} failed`, err);
        }
        continue;
      }
      const now = Date.now();
      if (now - lastIdleCheck >= IDLE_CHECK_INTERVAL_MS) {
        lastIdleCheck = now;
        try {
          const result = await autoShutdownIfIdle();
          if (result.stopped) console.log(`[worker] auto-stopped GPU: ${result.reason}`);
        } catch (err) {
          console.error("[worker] autoShutdownIfIdle error", err);
        }
      }
    } catch (err) {
      console.error("[worker] loop error", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down`);
  stopping = true;
  setTimeout(() => process.exit(0), 1_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

loop().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
