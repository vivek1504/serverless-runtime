import { runtimeStore } from "../runtime/store.js";
import { readVsockResponse } from "../runtime/protocol.js";
import { getVmSocket } from "../runtime/transport.js";
import { getSession, createSession, touchSession } from "./session.js";
import { gatewayLogger } from "../utils/logger.js";
import crypto from "crypto";
import type { Vm } from "../types/types.js";

import { createVm } from "../runtime/vm-manager.js";
import { Deque } from "../runtime/deque.js";

export async function ensureSession(sessionId: string): Promise<Vm> {
  let session = getSession(sessionId);
  if (session?.state === "active") {
    const fn = runtimeStore.functions.get(sessionId);
    if (fn && fn.vms.length > 0) return fn.vms[0]!;
  }

  session = session || createSession(sessionId);

  let fn = runtimeStore.functions.get(sessionId);
  if (!fn) {
    fn = {
      functionId: sessionId,
      queue: new Deque(),
      vms: [],
      readyVms: new Set(),
      weight: 1,
      inflightCount: 0,
      deficit: 0,
      pendingCreations: 0,
    };
    runtimeStore.functions.set(sessionId, fn);
  }

  if (fn.vms.length === 0) {
    await createVm(sessionId, fn, "__exec__");
  }

  session.state = "active";
  return fn.vms[0]!;
}

export async function sendSessionMessage(
  sessionId: string,
  message: Record<string, any>,
  onStream?: (chunk: any) => void,
  timeout: number = 60000,
): Promise<any> {
  const vm = await ensureSession(sessionId);
  touchSession(sessionId);

  const id = message.id || crypto.randomUUID();
  const fullMessage = { ...message, id };

  const socket = await getVmSocket(vm);
  socket.write(JSON.stringify(fullMessage) + "\n");

  gatewayLogger.debug(
    { sessionId, messageType: message.type, messageId: id },
    "message sent to VM"
  );

  const result = await readVsockResponse(socket, timeout, onStream);
  return { ...result, messageId: id };
}
