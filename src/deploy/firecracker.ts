import { spawn } from "child_process";
import fs from "fs";
import axios from "axios";
import path from "path";

export async function startFirecrackerProcess(apiSock: string) {
  const fc = spawn("firecracker", ["--api-sock", apiSock]);

  fc.on("error", console.error);
  fc.stderr.on("data", (d) => console.error(d.toString()));

  await waitForFile(apiSock, 5000);

  return fc;
}

export async function waitForFile(path: any, timeout = 5000) {
  const start = Date.now();

  while (true) {
    if (fs.existsSync(path)) return;

    if (Date.now() - start > timeout) {
      throw new Error("timeout waiting for socket");
    }

    await new Promise((r) => setTimeout(r, 100));
  }
}

export function createFcCient(apiSock: string) {
  return axios.create({
    socketPath: apiSock,
    baseURL: "http://localhost",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function configureVM(
  client: any,
  functionId: string,
  image: string,
) {
  await client.put("/machine-config", {
    vcpu_count: 1,
    mem_size_mib: 128,
  });

  await client.put("/boot-source", {
    kernel_image_path: path.resolve("vmlinux"),
    boot_args: "console=ttyS0 reboot=k panic=1 pci=off init=/init -- /start.sh",
  });

  await client.put("/drives/rootfs", {
    drive_id: "rootfs",
    path_on_host: image,
    is_root_device: true,
    is_read_only: false,
  });

  await client.put("/vsock", {
    vsock_id: "vsock0",
    guest_cid: Math.floor(Math.random() * 10000) + 3,
    uds_path: `/tmp/vsock-${functionId}.sock`,
  });

  await client.put("/logger", {
    log_path: `firecracker.log`,
    level: "Debug",
    show_level: true,
  });

  await client.put("/actions", {
    action_type: "InstanceStart",
  });
}

export function waitForVMReady(fc: any) {
  return new Promise<void>((resolve, reject) => {
    let buffer = "";

    const timeout = setTimeout(() => {
      reject(new Error("VM startup timeout"));
    }, 50000);

    fc.stdout.on("data", (d: Buffer) => {
      buffer += d.toString();

      if (buffer.includes("READY")) {
        clearTimeout(timeout);
        setTimeout(resolve, 200);
      }
    });
  });
}

export async function snapshotVM(client: any, functionId: string) {
  await client.patch("/vm", { state: "Paused" });

  await client.put("/snapshot/create", {
    snapshot_type: "Full",
    snapshot_path: path.resolve(`snapshot/snapshot-${functionId}`),
    mem_file_path: path.resolve(`mem/mem-${functionId}`),
  });
}

export async function cleanupResources(paths: any) {
  await Promise.allSettled([
    fs.promises.rm(paths.outputDir, { recursive: true, force: true }),
    fs.promises.rm(paths.apiSock),
    fs.promises.rm(paths.vsock),
  ]);
}
