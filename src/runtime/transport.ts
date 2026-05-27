import net, { Socket } from "net";
import { buildPayload, readVsockResponse } from "./protocol.js";
import type { Vm } from "../types/types.js";

export async function connectVsock(
  path: string,
  timeout = 5000,
): Promise<Socket> {
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

export async function getVmSocket(vm: Vm) {
  if (vm.socket && !vm.socket.destroyed) {
    return vm.socket;
  }

  vm.socket = await connectVsock(vm.vsock);

  vm.socket.write("CONNECT 5000\n");

  return vm.socket;
}

export async function sendRequest(subPath: string, req: any, res: any, vm: Vm) {
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
