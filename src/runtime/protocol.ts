import type { Socket } from "net";
import { protocolLogger } from "../utils/logger.js";

export function buildPayload(req: any, subPath: string): string {
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

export function readVsockResponse(
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
      protocolLogger.error({ timeoutMs: timeout }, "function execution timeout");
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
            if (msg.type === "error") {
              protocolLogger.warn(
                { errorData: msg.data, errorMsg: msg.error },
                "VM returned error response",
              );
            }
            resolve(msg);
            return;
          }
        } catch {
          protocolLogger.error({ rawLine: line }, "invalid JSON received from VM");
        }
      }
    };

    onError = (err) => {
      clearTimeout(timer);
      cleanup();
      protocolLogger.error({ err }, "vsock read error");
      reject(err);
    };

    onEnd = () => {
      clearTimeout(timer);
      cleanup();
      protocolLogger.error("vsock connection closed before response received");
      reject(new Error("Connection closed before response"));
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}
