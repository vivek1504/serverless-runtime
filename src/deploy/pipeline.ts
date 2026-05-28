import { extractZip, prepareRootfs } from "./rootfs.js";
import {
  startFirecrackerProcess,
  configureVM,
  createFcCient,
  waitForVMReady,
  snapshotVM,
  cleanupResources,
} from "./firecracker.js";
import fs from "fs";
import crypto from "crypto";
import { getPaths } from "../utils/path.js";
import { pipelineLogger } from "../utils/logger.js";

export async function deployFunction(zipPath: string) {
  const functionId = crypto.randomBytes(8).toString("hex");
  const paths = getPaths(functionId);
  let fc: ReturnType<typeof startFirecrackerProcess> extends Promise<infer T> ? T : never;

  pipelineLogger.info(
    { functionId, zipPath },
    "starting deployment pipeline",
  );

  try {
    // ── Stage 1: Extract zip ──────────────────────────────────────
    const t0 = performance.now();
    await extractZip(zipPath, paths.outputDir);
    const extractDuration = performance.now() - t0;
    pipelineLogger.info(
      { functionId, stage: "extract", durationMs: extractDuration },
      "zip extraction completed",
    );
    await fs.promises.unlink(zipPath);

    // ── Stage 2: Prepare rootfs ───────────────────────────────────
    const t1 = performance.now();
    const image = await prepareRootfs(functionId);
    const rootfsDuration = performance.now() - t1;
    pipelineLogger.info(
      { functionId, stage: "rootfs", durationMs: rootfsDuration, image },
      "rootfs preparation completed",
    );

    // ── Stage 3: Spawn Firecracker ────────────────────────────────
    const t2 = performance.now();
    fc = await startFirecrackerProcess(paths.apiSock);
    const spawnDuration = performance.now() - t2;
    pipelineLogger.info(
      { functionId, stage: "fc-spawn", durationMs: spawnDuration },
      "firecracker process spawned",
    );

    // ── Stage 4: Configure VM ─────────────────────────────────────
    const t3 = performance.now();
    const readyPromise = waitForVMReady(fc);
    const client = createFcCient(paths.apiSock);

    const t4 = performance.now();
    await configureVM(client, functionId, image);
    const configureDuration = performance.now() - t4;
    pipelineLogger.info(
      { functionId, stage: "configure-vm", durationMs: configureDuration },
      "VM configured",
    );

    // ── Stage 5: Wait for VM ready ────────────────────────────────
    await readyPromise;
    const readyDuration = performance.now() - t3;
    pipelineLogger.info(
      { functionId, stage: "vm-ready", durationMs: readyDuration },
      "VM reported READY",
    );

    // ── Stage 6: Snapshot ─────────────────────────────────────────
    const t5 = performance.now();
    await snapshotVM(client, functionId);
    const snapshotDuration = performance.now() - t5;
    pipelineLogger.info(
      { functionId, stage: "snapshot", durationMs: snapshotDuration },
      "VM snapshot created",
    );

    const totalDuration = performance.now() - t0;
    pipelineLogger.info(
      {
        functionId,
        stage: "complete",
        totalDurationMs: totalDuration,
        stages: {
          extractMs: extractDuration,
          rootfsMs: rootfsDuration,
          spawnMs: spawnDuration,
          configureMs: configureDuration,
          readyMs: readyDuration,
          snapshotMs: snapshotDuration,
        },
      },
      "deployment pipeline completed successfully",
    );

    return {
      functionId,
      url: `http://localhost:3000/f/${functionId}`,
    };
  } catch (err) {
    pipelineLogger.error(
      { functionId, err },
      "deployment pipeline failed",
    );
    throw err;
  } finally {
    // Always kill the FC process — whether deploy succeeded or failed
    try { fc!?.kill("SIGKILL"); } catch { }

    const t6 = performance.now();
    await cleanupResources(paths);
    pipelineLogger.debug(
      { functionId, stage: "cleanup", durationMs: performance.now() - t6 },
      "post-deploy cleanup completed",
    );
  }
}
