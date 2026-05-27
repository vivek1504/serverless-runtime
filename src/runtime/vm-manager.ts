import { spawn } from "child_process";
import net from "net";
import axios from "axios";
import path from "path";
import crypto from "crypto";

import type { RuntimeFunction, Vm } from "../types/types.js";

export async function createVm(
  functionId: string,
  fn: RuntimeFunction,
): Promise<Vm> {
  const instanceId = crypto.randomBytes(4).toString("hex");
  const apiSock = `/tmp/firecracker-${functionId}-${instanceId}.socket`;
  const vsock = `/tmp/vsock-${functionId}-${instanceId}.sock`;
  const fc = spawn("firecracker", ["--api-sock", apiSock]);

  await waitForFirecrackerApiSocket(apiSock);

  const client = createFcClient(apiSock);
  await restoreVm(client, functionId, vsock);

  const vm: Vm = {
    id: instanceId,
    state: "ready",
    firecrackerProcess: fc,
    apiSock,
    vsock,
    idleTime: Date.now(),
  };

  fn.vms.push(vm);
  return vm;
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
        resolve();
      });

      client.once("error", () => {
        client.destroy();

        if (Date.now() - start > timeout) {
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
}
