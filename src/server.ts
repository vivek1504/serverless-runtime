import net, { Socket } from "net";
import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import extract from "extract-zip";
import fs from "fs";
import { execSync, spawn } from "child_process";
import axios from "axios";

const app = express();
app.use(express.json());

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

app.post("/deploy", upload.single("code"), async (req, res) => {
  const zipPath = req.file?.path;
  const extractPath = path.resolve("extracted");
  const functionId = crypto.randomBytes(8).toString("hex");
  const outputDir = path.join(extractPath, functionId);

  const apiSock = `/tmp/firecracker-${functionId}.socket`;

  if (!zipPath) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  try {
    await extract(zipPath, {
      dir: outputDir,
      onEntry: (entry) => {
        if (entry.fileName.includes("..")) {
          throw new Error("Invalid zip content");
        }
      },
    });
    fs.promises.unlink(zipPath!);

    const image = createRootfs(functionId);
    injectCodeIntoImage(functionId, image);
    cleanup(functionId);

    const fc = spawn("firecracker", ["--api-sock", apiSock]);
    fc.on("error", (err) => console.error("FC error:", err));
    fc.stderr.on("data", (d) => console.error("FC stderr:", d.toString()));

    console.log("stuck at checking api sock");
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (fs.existsSync(apiSock)) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

    console.log("stuck at timeout");
    const fcClient = axios.create({
      socketPath: apiSock,
      baseURL: "http://localhost",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const bootRes = await fcClient.put("/boot-source", {
      kernel_image_path: path.resolve("vmlinux-6.1.155"),
      boot_args:
        "console=ttyS0 reboot=k panic=1 pci=off init=/init -- /start.sh",
    });

    const driveRes = await fcClient.put("/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: path.resolve(`rootfs/rootfs-${functionId}.ext4`),
      is_root_device: true,
      is_read_only: false,
    });

    const vsockRes = await fcClient.put("/vsock", {
      vsock_id: "vsock0",
      guest_cid: Math.floor(Math.random() * 10000) + 3,
      uds_path: `/tmp/vsock-${functionId}.sock`,
    });

    const logRes = await fcClient.put("/logger", {
      log_path: `firecracker.log`,
      level: "Debug",
      show_level: true,
    });

    const startRes = await fcClient.put("/actions", {
      action_type: "InstanceStart",
    });

    await new Promise<void>((resolve) => {
      fc.stdout.on("data", (d) => {
        const msg = d.toString();
        if (msg.includes("READY")) {
          setTimeout(resolve, 200);
        }
      });
    });

    try {
      const pauseVm = await fcClient.patch("/vm", {
        state: "Paused",
      });

      const createSnapshot = await fcClient.put("/snapshot/create", {
        snapshot_type: "Full",
        snapshot_path: `./snapshot/snapshot_file-${functionId}`,
        mem_file_path: `./mem/mem_file-${functionId}`,
      });
    } finally {
      fc.kill("SIGTERM");

      await new Promise((resolve) => fc.on("exit", resolve));

      fs.promises.rm(`/tmp/firecracker-${functionId}.socket`, { force: true });
      fs.promises.rm(`/tmp/vsock-${functionId}.sock`, { force: true });
      fs.promises.rm(`extracted/${functionId}`, {
        recursive: true,
        force: true,
      });
    }

    res.json({
      message: "Deployment successful",
      url: `http://localhost:3000/f/${functionId}`,
    });
  } catch (err: any) {
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err);
    }

    res.status(500).json({
      error: err.message,
    });
  }
});

app.use("/f/:functionId", async (req, res) => {
  const functionId = req.params.functionId;
  const subPath = req.path || "/";
  const apiSock = `/tmp/firecracker-${functionId}.socket`;
  const fc = spawn("firecracker", ["--api-sock", apiSock]);
  fc.stderr.on("data", (d) => console.error("FC:", d.toString()));

  await waitForFirecrackerApiSocket(apiSock);

  const fcClient = axios.create({
    socketPath: apiSock,
    baseURL: "http://localhost",
    headers: {
      "Content-Type": "application/json",
    },
  });

  try {
    await fcClient.put("/snapshot/load", {
      snapshot_path: `./snapshot/snapshot_file-${functionId}`,
      mem_backend: {
        backend_path: `./mem/mem_file-${functionId}`,
        backend_type: "File",
      },
      track_dirty_pages: true,
      resume_vm: true,
    });
  } catch (err: any) {
    console.error("Data ", err.response?.data);
    console.error("Status ", err.response?.status);
  }

  let buffer = "";

  let responded = false;
  function safeSend(fn: () => void) {
    if (!responded) {
      responded = true;
      fn();
    }
  }

  const socket = await connectVsock(`/tmp/vsock-${functionId}.sock`);

  const timeout = setTimeout(() => {
    socket.destroy();
    safeSend(() => res.status(504).send("Function timeout"));
  }, 10000);

  socket.write("CONNECT 5000\n");

  const payload =
    JSON.stringify({
      httpMethod: req.method,
      path: subPath,
      headers: req.headers,
      query: req.query,
      body: JSON.stringify(req.body || {}),
    }) + "\n";

  socket.write(payload);

  socket.on("data", (chunk) => {
    buffer += chunk.toString();

    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);

      if (!line.trim()) continue;

      if (line.startsWith("OK")) {
        continue;
      }

      try {
        const msg = JSON.parse(line);

        if (msg.type === "response") {
          clearTimeout(timeout);
          console.log("response: ", msg.data);

          safeSend(() => {
            const body = JSON.parse(msg.data.body);
            res.status(msg.data.statusCode || 200).json(body);
          });
        }
        if (msg.type === "error") {
          clearTimeout(timeout);
          console.log("error: ", msg.data);
          safeSend(() => {
            const body = JSON.stringify(msg.data.body);
            res.status(msg.data.statusCode || 500).json(body);
          });
        }
      } catch (e) {
        console.error("invalid json,", line);
      }
    }
  });

  socket.on("end", () => {
    console.log("connection closed");
  });

  socket.on("error", (err) => {
    console.error("error", err);
    safeSend(() => res.status(500).json({ msg: "internal server error" }));
  });
});

app.listen(3000, () => {
  console.log("listen");
});

function createRootfs(functionId: string) {
  const baseImage = "rootfs.ext4";
  const image = `rootfs/rootfs-${functionId}.ext4`;

  execSync(`cp ${baseImage} ${image}`);

  return image;
}

function injectCodeIntoImage(functionId: string, image: string) {
  const mountDir = `/mnt/rootfs-${functionId}`;
  const extracted = `extracted/${functionId}`;

  execSync(`sudo mkdir -p ${mountDir}`);
  execSync(`sudo mount -o loop ${image} ${mountDir}`);

  execSync(`sudo cp -r ${extracted}/. ${mountDir}/app/`);

  execSync(`sudo umount ${mountDir}`);
  execSync(`sudo rm -rf ${mountDir}`);
}

function cleanup(functionId: string) {
  const extractedDir = `extracted/${functionId}`;

  try {
    fs.rmSync(extractedDir, { recursive: true, force: true });

    console.log(`Cleanup completed for ${functionId}`);
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}

async function connectVsock(path: string, timeout = 5000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const tryConnect = () => {
      const socket = net.createConnection({ path });

      socket.once("connect", () => {
        resolve(socket);
      });

      socket.once("error", () => {
        socket.destroy();

        if (Date.now() - start > timeout) {
          return reject(new Error("Vsock timeout"));
        }
        setTimeout(tryConnect, 100);
      });
    };
    tryConnect();
  });
}

async function waitForFirecrackerApiSocket(path: string, timeout = 5000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();

    const tryConnect = () => {
      const client = net.createConnection({ path });

      client.once("connect", () => {
        client.destroy();
        resolve();
      });

      client.once("error", (err: any) => {
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
