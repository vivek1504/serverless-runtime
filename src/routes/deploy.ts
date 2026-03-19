import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import extract from "extract-zip";
import fs from "fs";
import { execSync, spawn } from "child_process";
import axios from "axios";
import { getPaths } from "../utils/path.js";

export const deployRouter = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "userCode/");
  },
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString("hex");
    cb(null, id + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

deployRouter.post("/", upload.single("code"), async (req, res) => {
  try {
    if (!req.file?.path) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const result = await deployFunction(req.file.path);

    res.json({
      msg: "Deployment Successful",
      url: result.url,
    });
  } catch (err: any) {
    console.error(err?.response?.data || err);
    res.status(500).json({ error: err.message });
  }
});

async function deployFunction(zipPath: string) {
  const functionId = crypto.randomBytes(8).toString("hex");
  const paths = getPaths(functionId);

  try {
    await extractZip(zipPath, paths.outputDir);
    await fs.promises.unlink(zipPath);

    const image = prepareRootfs(functionId);

    const fc = await startFirecrackerProcess(paths.apiSock);

    const readyPromise = waitForVMReady(fc);

    const client = createFcCient(paths.apiSock);

    await configureVM(client, functionId, image);

    await readyPromise;

    await snapshotVM(client, functionId);

    await stopFirecracker(fc);

    return {
      functionId,
      url: `http://localhost:3000/f/${functionId}`,
    };
  } finally {
    await cleanupResources(paths);
  }
}

async function extractZip(zip: string, outputDir: string) {
  await extract(zip, {
    dir: outputDir,
    onEntry: (entry) => {
      if (entry.fileName.includes("..")) {
        throw new Error("Invalid zip content");
      }
    },
  });
}

function prepareRootfs(functionId: string) {
  const baseImage = "rootfs.ext4";
  const image = `rootfs/rootfs-${functionId}.ext4`;

  execSync(`cp ${baseImage} ${image}`);

  const mountDir = `/mnt/rootfs-${functionId}`;
  const extracted = `extracted/${functionId}`;

  execSync(`sudo mkdir -p ${mountDir}`);
  execSync(`sudo mount -o loop ${image} ${mountDir}`);

  execSync(`sudo cp -r ${extracted}/. ${mountDir}/app/`);

  execSync(`sudo umount ${mountDir}`);
  execSync(`sudo rm -rf ${mountDir}`);

  return image;
}

async function startFirecrackerProcess(apiSock: string) {
  const fc = spawn("firecracker", ["--api-sock", apiSock]);

  fc.on("error", console.error);
  fc.stderr.on("data", (d) => console.error(d.toString()));

  await waitForFile(apiSock, 5000);

  return fc;
}

async function waitForFile(path: any, timeout = 5000) {
  const start = Date.now();

  while (true) {
    if (fs.existsSync(path)) return;

    if (Date.now() - start > timeout) {
      throw new Error("timeout waiting for socket");
    }

    await new Promise((r) => setTimeout(r, 100));
  }
}

function createFcCient(apiSock: string) {
  return axios.create({
    socketPath: apiSock,
    baseURL: "http://localhost",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function configureVM(client: any, functionId: string, image: string) {
  await client.put("/boot-source", {
    kernel_image_path: path.resolve("vmlinux-6.1.155"),
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

function waitForVMReady(fc: any) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("VM startup timeout"));
    }, 50000);

    fc.stdout.on("data", (d: Buffer) => {

      if (d.toString().includes("READY")) {
        clearTimeout(timeout);
        setTimeout(resolve, 200);
      }
    });
  });
}

async function snapshotVM(client: any, functionId: string) {
  await client.patch("/vm", { state: "Paused" });

  await client.put("/snapshot/create", {
    snapshot_type: "Full",
    snapshot_path: path.resolve(`snapshot/snapshot-${functionId}`),
    mem_file_path: path.resolve(`mem/mem-${functionId}`),
  });
}

async function stopFirecracker(fc: any) {
  fc.kill("SIGTERM");
  await new Promise((res) => fc.on("exit", res));
}

async function cleanupResources(paths: any) {
  await Promise.allSettled([
    fs.promises.rm(paths.apiSock, { force: true }),
    fs.promises.rm(paths.vsock, { force: true }),
    fs.promises.rm(paths.outputDir, { recursive: true, force: true }),
  ]);
}
