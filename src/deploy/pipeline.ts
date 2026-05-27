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

export async function deployFunction(zipPath: string) {
  const functionId = crypto.randomBytes(8).toString("hex");
  const paths = getPaths(functionId);
  let fc: ReturnType<typeof startFirecrackerProcess> extends Promise<infer T> ? T : never;

  try {
    const t0 = performance.now();
    await extractZip(zipPath, paths.outputDir);
    console.log("extract:", performance.now() - t0);
    await fs.promises.unlink(zipPath);

    const t1 = performance.now();
    const image = await prepareRootfs(functionId);
    console.log("rootfs:", performance.now() - t1);

    const t2 = performance.now();
    fc = await startFirecrackerProcess(paths.apiSock);
    console.log("fc spawn:", performance.now() - t2);

    const t3 = performance.now();
    const readyPromise = waitForVMReady(fc);
    const client = createFcCient(paths.apiSock);

    const t4 = performance.now();
    await configureVM(client, functionId, image);
    console.log("configure Vm: ", performance.now() - t4);

    await readyPromise;
    console.log("wait for vmReady: ", performance.now() - t3);

    const t5 = performance.now();
    await snapshotVM(client, functionId);
    console.log("snapshot time: ", performance.now() - t5);

    return {
      functionId,
      url: `http://localhost:3000/f/${functionId}`,
    };
  } finally {
    // Always kill the FC process — whether deploy succeeded or failed
    try { fc!?.kill("SIGKILL"); } catch { }

    const t6 = performance.now();
    await cleanupResources(paths);
    console.log("cleanupResources: ", performance.now() - t6);
  }
}
