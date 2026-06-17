import type { ChildProcessWithoutNullStreams } from "child_process";
import type { Socket } from "net";
import type { Deque } from "../runtime/deque.js";

export type VmState = "creating" | "restoring" | "ready" | "busy" | "dead";

export interface Vm {
  id: string;
  state: VmState;
  firecrackerProcess: ChildProcessWithoutNullStreams;
  apiSock: string;
  vsock: string;
  idleTime: number;
  socket?: Socket;
  cleaned?: boolean;
}

export interface RequestTask {
  req: any;
  res: any;
  subPath: string;
  resolve: () => void;
  reject: (err: any) => void;
  enqueuedAt: number;
}

export interface RuntimeFunction {
  functionId: string;
  weight: number;
  deficit: number;
  inflightCount: number;
  pendingCreations: number;
  queue: Deque<RequestTask>;
  vms: Vm[];
  readyVms: Set<Vm>;
}
