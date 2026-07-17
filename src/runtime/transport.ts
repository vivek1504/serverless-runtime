import net, { Socket } from "net";
import { buildPayload, readVsockResponse } from "./protocol.js";
import { transportLogger } from "../utils/logger.js";
import { vsockConnectionTime, vsockErrors } from "../utils/metrics.js";
import type { Vm } from "../types/types.js";

export async function connectVsock(
  path: string,
  timeout = 5000,
): Promise<Socket> {
  transportLogger.debug({ path, timeoutMs: timeout }, "connecting to vsock");
  const start = performance.now();

  return new Promise((resolve, reject) => {
    const connectStart = Date.now();

    const tryConnect = () => {
      const socket = net.createConnection({ path });

      socket.once("connect", () => {
        const durationSec = (performance.now() - start) / 1000;
        vsockConnectionTime.observe(durationSec);
        transportLogger.debug(
          { path, elapsedMs: Date.now() - connectStart },
          "vsock connected",
        );
        resolve(socket);
      });

      socket.once("error", () => {
        socket.destroy();

        if (Date.now() - connectStart > timeout) {
          vsockErrors.inc({ error_type: "timeout" });
          transportLogger.error({ path, timeoutMs: timeout }, "vsock connection timeout");
          return reject(new Error("Vsock timeout"));
        }

        setTimeout(tryConnect, 100);
      });
    };

    tryConnect();
  });
}

export async function getVmSocket(vm: Vm) {
  if (vm.socket && !vm.socket.destroyed) {
    return vm.socket;
  }

  transportLogger.debug({ vmId: vm.id, vsock: vm.vsock }, "establishing new VM socket");
  vm.socket = await connectVsock(vm.vsock);
  vm.socket.write("CONNECT 5000\n");

  return vm.socket;
}

export async function sendRequest(subPath: string, req: any, res: any, vm: Vm) {
  const socket = await getVmSocket(vm);
  socket.write(buildPayload(req, subPath));

  transportLogger.debug(
    { vmId: vm.id, method: req.method, subPath },
    "request payload sent to VM",
  );

  const msg = await readVsockResponse(socket, 10000);

  if (msg.type === "response") {
    const statusCode = msg.data.statusCode || 200;

    try {
      const body = JSON.parse(msg.data.body);
      res.status(statusCode).json(body);
    } catch {
      res.status(statusCode).send(msg.data.body ?? "");
    }

    transportLogger.debug(
      { vmId: vm.id, statusCode },
      "response forwarded to client",
    );
  } else {
    const statusCode = msg.data?.statusCode || 500;
    transportLogger.error(
      { vmId: vm.id, statusCode, error: msg.error },
      "VM returned error response",
    );
    res.status(statusCode).json(msg.data ?? { error: msg.error });
  }
}

export async function sendMessage(
  vm: Vm,
  message: Record<string, any>,
  onStreamChunk?: (chunk: any) => void,
  timeout: number = 60000,
): Promise<any> {
  const socket = await getVmSocket(vm);
  socket.write(JSON.stringify(message) + "\n");

  transportLogger.debug(
    { vmId: vm.id, messageType: message.type, messageId: message.id },
    "message sent to VM"
  );

  return readVsockResponse(socket, timeout, onStreamChunk);
}
