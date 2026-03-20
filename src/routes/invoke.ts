import { Router } from "express";
import { getPaths } from "../utils/path.js";
import { spawn } from "child_process";
import net, { Socket } from "net";
import axios from "axios";
import path from "path";
import crypto from "crypto";
import { warmPool } from "../pool.js";

export const invokeRouter = Router();

invokeRouter.use("/:functionId", async (req, res) => {
    const functionId = req.params.functionId;
    const paths = getPaths(functionId);
    const subPath = req.path || "/";

    try {
        const vm = warmPool.get(functionId)?.find((vm) => !vm.busy);

        if (vm) {
            vm.busy = true;
            await sendRequest(vm.vsock, subPath, req, res);
            vm.busy = false;
            vm.idleTime = Date.now();
        } else {
            const instanceId = crypto.randomBytes(4).toString("hex");
            const apiSock = `/tmp/firecracker-${functionId}-${instanceId}.socket`;
            const vsock = `/tmp/vsock-${functionId}-${instanceId}.sock`;

            const fc = spawn("firecracker", ["--api-sock", apiSock]);
            fc.stderr.on("data", (d) => console.error("FC:", d.toString()));

            await waitForFirecrackerApiSocket(apiSock);
            const client = createFcCient(apiSock);
            await restoreVm(client, functionId);
            await sendRequest(vsock, subPath, req, res);

            let existing = warmPool.get(functionId);

            if (!existing) {
                existing = [];
                warmPool.set(functionId, existing);
            }

            existing.push({
                firecrackerProcess: fc,
                apiSock,
                vsock,
                busy: false,
                idleTime: Date.now(),
            });
        }

    } catch (e) {
        console.error(e);
        if (!res.headersSent) {
            res.status(500).json({ msg: "internal server error" });
        }
    }
});


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

async function restoreVm(client: any, functionId: string) {
    await client.put("/snapshot/load", {
        snapshot_path: path.resolve(`snapshot/snapshot-${functionId}`),
        mem_backend: {
            backend_path: path.resolve(`mem/mem-${functionId}`),
            backend_type: "File",
        },
        track_dirty_pages: true,
        resume_vm: true,
    })
}

function buildPayload(req: any, subPath: string): string {
    return JSON.stringify({
        httpMethod: req.method,
        path: subPath,
        headers: req.headers,
        query: req.query,
        body: JSON.stringify(req.body || {}),
    }) + "\n";
}

function readVsockResponse(socket: Socket, timeout: number): Promise<{ type: string; data: any; error?: string }> {
    return new Promise((resolve, reject) => {
        let buffer = "";

        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error("Function timeout"));
        }, timeout);

        socket.on("data", (chunk) => {
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
                        resolve(msg);
                        return;
                    }
                } catch {
                    console.error("invalid json:", line);
                }
            }
        });

        socket.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });

        socket.on("end", () => {
            clearTimeout(timer);
            reject(new Error("Connection closed before response"));
        });
    });
}

async function sendRequest(vsockPath: string, subPath: string, req: any, res: any) {
    const socket = await connectVsock(vsockPath);

    socket.write("CONNECT 5000\n");
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
        res.status(msg.data?.statusCode || 500).json(msg.data ?? { error: msg.error });
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