import net, { Socket } from "net";
import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import extract from "extract-zip";
import fs from "fs";
import { execSync, spawn } from "child_process";
import axios from "axios";
import { deployRouter } from "./routes/deploy.js";

const app = express();
app.use(express.json());

app.use("/deploy", deployRouter);

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
      snapshot_path: path.resolve(`snapshot/snapshot-${functionId}`),
      mem_backend: {
        backend_path: path.resolve(`mem/mem-${functionId}`),
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
