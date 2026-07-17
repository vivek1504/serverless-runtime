import { spawn } from "child_process";
import net from "net";
import axios from "axios";
import path from "path";
import crypto from "crypto";
import { vmManagerLogger } from "../utils/logger.js";
import { vmCount, vmCreationTime, vmCreationTotal } from "../utils/metrics.js";

import type { RuntimeFunction, Vm } from "../types/types.js";

export async function createVm(
  functionId: string,
  fn: RuntimeFunction,
  snapshotId?: string,
): Promise<Vm> {
  const instanceId = crypto.randomBytes(4).toString("hex");
  const apiSock = `/tmp/firecracker-${functionId}-${instanceId}.socket`;
  const vsock = `/tmp/vsock-${functionId}-${instanceId}.sock`;
  const start = performance.now();

  vmManagerLogger.info(
    { functionId, instanceId, apiSock, vsock },
    "creating new VM instance",
  );

  vmCount.inc({ function_id: functionId, state: "creating" });

  try {
    const fc = spawn("firecracker", ["--api-sock", apiSock]);

    fc.on("error", (err) => {
      vmManagerLogger.error({ instanceId, err }, "firecracker process error");
    });

    fc.on("exit", (code, signal) => {
      vmManagerLogger.info({ instanceId, exitCode: code, signal }, "firecracker process exited");
    });

    await waitForFirecrackerApiSocket(apiSock);

    const client = createFcClient(apiSock);
    await restoreVm(client, snapshotId || functionId, vsock);

    const vm: Vm = {
      id: instanceId,
      state: "ready",
      firecrackerProcess: fc,
      apiSock,
      vsock,
      idleTime: Date.now(),
    };

    fn.vms.push(vm);
    fn.readyVms.add(vm);

    const durationSec = (performance.now() - start) / 1000;
    vmCreationTime.observe(durationSec);
    vmCreationTotal.inc({ status: "success" });
    vmCount.dec({ function_id: functionId, state: "creating" });
    vmCount.inc({ function_id: functionId, state: "ready" });

    vmManagerLogger.info(
      { functionId, instanceId, totalVms: fn.vms.length, durationMs: durationSec * 1000 },
      "VM instance created and ready",
    );
    return vm;
  } catch (err) {
    const durationSec = (performance.now() - start) / 1000;
    vmCreationTime.observe(durationSec);
    vmCreationTotal.inc({ status: "error" });
    vmCount.dec({ function_id: functionId, state: "creating" });

    vmManagerLogger.error(
      { functionId, instanceId, err, durationMs: durationSec * 1000 },
      "VM creation failed",
    );
    throw err;
  }
}

export async function waitForFirecrackerApiSocket(
  path: string,
  timeout = 5000,
) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();

    const tryConnect = () => {
      const client = net.createConnection({ path });

      client.once("connect", () => {
        client.destroy();
        vmManagerLogger.debug(
          { path, elapsedMs: Date.now() - start },
          "API socket connected",
        );
        resolve();
      });

      client.once("error", () => {
        client.destroy();

        if (Date.now() - start > timeout) {
          vmManagerLogger.error({ path, timeoutMs: timeout }, "API socket connection timeout");
          return reject(new Error("socket timeout"));
        }
        setTimeout(tryConnect, 50);
      });
    };

    tryConnect();
  });
}

export function createFcClient(apiSock: string) {
  return axios.create({
    socketPath: apiSock,
    baseURL: "http://localhost",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function restoreVm(
  client: any,
  functionId: string,
  vsock: string,
) {
  vmManagerLogger.debug({ functionId, vsock }, "restoring VM from snapshot");

  await client.put("/snapshot/load", {
    snapshot_path: path.resolve(`snapshot/snapshot-${functionId}`),
    mem_backend: {
      backend_path: path.resolve(`mem/mem-${functionId}`),
      backend_type: "File",
    },
    track_dirty_pages: true,
    resume_vm: true,
    vsock_override: {
      uds_path: vsock,
    },
  });

  vmManagerLogger.debug({ functionId }, "VM restored from snapshot");
}
