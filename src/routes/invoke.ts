import { Router } from "express";
import { getPaths } from "../utils/path.js";
import { spawn } from "child_process";
import net, { Socket } from "net";
import axios from "axios";
import path from "path";
import crypto from "crypto";
import { type Vm } from "../pool.js";
import fs from "fs";

export const invokeRouter = Router();

const MAX_VMS = 100;

interface requestTask {
  req: any;
  res: any;
  subPath: string;
  resolve: () => void;
  reject: (err: any) => void;
}

interface functionType {
  queue: requestTask[];
  vms: Vm[];
  functionId: string;
}

const functions = new Map<string, functionType>();

invokeRouter.use("/:functionId", async (req, res) => {
  const functionId = req.params.functionId;
  const paths = getPaths(functionId);
  const subPath = req.path || "/";

  try {
    let fn = functions.get(functionId);

    if (!fn) {
      fn = {
        functionId,
        queue: [],
        vms: [],
      };
      functions.set(functionId, fn);
    }

    await new Promise<void>((resolve, reject) => {
      const task: requestTask = { req, res, subPath, resolve, reject };
      fn!.queue.push(task);
      processRequest(fn!);
    });
  } catch (e: any) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ msg: "internal server error" });
    }
  }
});

async function createVm(functionId: string, fn: functionType) {
  console.log("\x1b[32mCreate Vm\x1b[0m");
  const instanceId = crypto.randomBytes(4).toString("hex");
  const apiSock = `/tmp/firecracker-${functionId}-${instanceId}.socket`;
  const vsock = `/tmp/vsock-${functionId}-${instanceId}.sock`;

  const fc = spawn("firecracker", ["--api-sock", apiSock]);
  fc.stderr.on("data", (d) => console.error("FC:", d.toString()));
  fc.on("exit", () => {
    console.log("VM exited:", instanceId);

    const fn = functions.get(functionId);
    if (!fn) return;

    const vm = fn.vms.find((v) => v.firecrackerProcess === fc);
    if (!vm) return;

    cleanupVm(fn, vm);
  });

  await waitForFirecrackerApiSocket(apiSock);
  const client = createFcCient(apiSock);
  await restoreVm(client, functionId, vsock);

  const newVm: Vm = {
    firecrackerProcess: fc,
    apiSock,
    vsock,
    busy: true,
    idleTime: Date.now(),
  };

  fn.vms.push(newVm);
  return newVm;
}

async function processRequest(fn: functionType) {
  if (fn.queue.length === 0) return;

  let vm = fn.vms.find((v) => !v.busy);

  if (!vm && fn.vms.length < MAX_VMS) {
    vm = await createVm(fn.functionId, fn);
  }

  if (!vm) return;

  const task = fn.queue.shift();
  if (!task) return;

  vm.busy = true;

  handleTask(fn, vm, task);
}

async function handleTask(fn: functionType, vm: Vm, task: requestTask) {
  try {
    await sendRequest(task.subPath, task.req, task.res, vm);
    task.resolve();
  } catch (err) {
    task.reject(err);
  } finally {
    vm.busy = false;
    vm.idleTime = Date.now();

    processRequest(fn);
  }
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

function createFcCient(apiSock: string) {
  return axios.create({
    socketPath: apiSock,
    baseURL: "http://localhost",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function restoreVm(client: any, functionId: string, Vsock: string) {
  await client.put("/snapshot/load", {
    snapshot_path: path.resolve(`snapshot/snapshot-${functionId}`),
    mem_backend: {
      backend_path: path.resolve(`mem/mem-${functionId}`),
      backend_type: "File",
    },
    track_dirty_pages: true,
    resume_vm: true,
    vsock_override: {
      uds_path: Vsock,
    },
  });
}

function buildPayload(req: any, subPath: string): string {
  return (
    JSON.stringify({
      httpMethod: req.method,
      path: subPath,
      headers: req.headers,
      query: req.query,
      body: JSON.stringify(req.body || {}),
    }) + "\n"
  );
}

function readVsockResponse(
  socket: Socket,
  timeout: number,
): Promise<{ type: string; data: any; error?: string }> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    let onData: (chunk: Buffer) => void;
    let onError: (err: Error) => void;
    let onEnd: () => void;

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("end", onEnd);
    };

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Function timeout"));
    }, timeout);

    onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim() || line.startsWith("OK")) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "response" || msg.type === "error") {
            clearTimeout(timer);
            cleanup();
            resolve(msg);
            return;
          }
        } catch {
          console.error("invalid json:", line);
        }
      }
    };

    onError = (err: Error) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    };

    onEnd = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Connection closed before response"));
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

async function sendRequest(subPath: string, req: any, res: any, vm: Vm) {
  const socket = await getVmSocket(vm);

  socket.write(buildPayload(req, subPath));

  const msg = await readVsockResponse(socket, 10000);

  if (msg.type === "response") {
    const statusCode = msg.data.statusCode || 200;
    try {
      const body = JSON.parse(msg.data.body);
      res.status(statusCode).json(body);
    } catch {
      res.status(statusCode).send(msg.data.body ?? "");
    }
  } else {
    res
      .status(msg.data?.statusCode || 500)
      .json(msg.data ?? { error: msg.error });
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

async function getVmSocket(vm: Vm) {
  if (vm.socket && !vm.socket.destroyed) {
    return vm.socket;
  }

  vm.socket = await connectVsock(vm.vsock);
  vm.socket.write("CONNECT 5000\n");
  return vm.socket;
}

async function cleanupVm(fn: functionType, vm: Vm) {
  try {
    vm.firecrackerProcess.kill();
  } catch (e) {
    console.error("Error Killing vm: ", e);
  }

  try {
    if (fs.existsSync(vm.apiSock)) fs.unlinkSync(vm.apiSock);
    if (fs.existsSync(vm.vsock)) fs.unlinkSync(vm.vsock);
  } catch (e) {
    console.error("Error cleaning sockets:", e);
  }

  fn.vms = fn.vms.filter((v) => v !== vm);
}

setInterval(() => {
  const now = Date.now();

  for (const [functionId, fn] of functions.entries()) {
    for (const vm of [...fn.vms]) {
      if (!vm.busy && now - vm.idleTime > 30000) {
        cleanupVm(fn, vm);
      }
    }

    if (fn.vms.length === 0 && fn.queue.length === 0) {
      functions.delete(functionId);
    }
  }
}, 10000);
