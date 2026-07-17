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

export interface ExecuteMessage {
  type: "execute";
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface WriteFileMessage {
  type: "write_file";
  id: string;
  path: string;
  content: string;
  mode?: number;
}

export interface ReadFileMessage {
  type: "read_file";
  id: string;
  path: string;
}

export interface ListFilesMessage {
  type: "list_files";
  id: string;
  path?: string;
  recursive?: boolean;
}

export interface CancelMessage {
  type: "cancel";
  id: string;
}

export interface StreamMessage {
  type: "stream";
  id: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface ResponseMessage {
  type: "response";
  id: string;
  data: any;
}

export interface ErrorMessage {
  type: "error";
  id: string;
  error: string;
  code?: number;
}
