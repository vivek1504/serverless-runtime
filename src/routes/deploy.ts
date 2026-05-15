import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import extract from "extract-zip";
import fs from "fs";
import { exec as execCb, spawn } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);
import axios from "axios";
import { getPaths } from "../utils/path.js";
import { performance } from "perf_hooks";
import PQueue from "p-queue";

export const deployRouter = Router();

type JobStatus =
  | { state: "pending" }
  | { state: "running" }
  | { state: "done"; functionId: string; url: string }
  | { state: "error"; message: string };

const jobs = new Map<string, JobStatus>();
const deployQueue = new PQueue({ concurrency: 3 });

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
  if (!req.file?.path) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (deployQueue.size > 50) {
    return res.status(429).json({ error: "Too many jobs" });
  }

  const jobId = crypto.randomBytes(8).toString("hex");
  jobs.set(jobId, { state: "pending" });

  deployQueue.add(async () => {
    jobs.set(jobId, { state: "running" })
    try {
      const result = await deployFunction(req.file!.path)
      jobs.set(jobId, { state: "done", functionId: result.functionId, url: result.url })
    } catch (err: any) {
      jobs.set(jobId, { state: "error", message: err.message })
    }
  })

  res.status(202).json({ jobId, statusUrl: `/deploy/status/${jobId}` });
});

deployRouter.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Unknown job" });
  res.json(job);
});

async function deployFunction(zipPath: string) {
  const functionId = crypto.randomBytes(8).toString("hex");
  const paths = getPaths(functionId);

  try {
    const t0 = performance.now();
    await extractZip(zipPath, paths.outputDir);
    console.log("extract:", performance.now() - t0);
    await fs.promises.unlink(zipPath);

    const t1 = performance.now();
    const image = await prepareRootfs(functionId);
    console.log("rootfs:", performance.now() - t1);

    const t2 = performance.now();
    const fc = await startFirecrackerProcess(paths.apiSock);
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

    fc.kill("SIGKILL");
    return {
      functionId,
      url: `http://localhost:3000/f/${functionId}`,
    };
  } finally {
    const t6 = performance.now();
    await cleanupResources(paths);
    console.log("cleanupResources: ", performance.now() - t6);
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

async function prepareRootfs(functionId: string) {
  const baseImage = "rootfs.ext4";
  const image = `rootfs/rootfs-${functionId}.ext4`;

  await exec(`cp --reflink=auto ${baseImage} ${image}`);

  const mountDir = `/mnt/rootfs-${functionId}`;
  const extracted = `extracted/${functionId}`;

  await exec(`sudo mkdir -p ${mountDir}`);
  await exec(`sudo mount -o loop ${image} ${mountDir}`);

  await exec(`sudo cp -r ${extracted}/. ${mountDir}/app/`);

  await exec(`sudo umount ${mountDir}`);
  await exec(`sudo rm -rf ${mountDir}`);

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

async function cleanupResources(paths: any) {
  await Promise.allSettled([
    fs.promises.rm(paths.outputDir, { recursive: true, force: true }),
    fs.promises.rm(paths.apiSock),
    fs.promises.rm(paths.vsock),
  ]);
}
