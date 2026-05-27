import type { ChildProcessWithoutNullStreams } from "child_process";
import type { Socket } from "net";

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
}

export interface RuntimeFunction {
  functionId: string;
  queue: RequestTask[];
  vms: Vm[];
  processing: boolean;
}
