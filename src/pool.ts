import type { ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";

export interface Vm {
  firecrackerProcess: ChildProcessWithoutNullStreams;
  apiSock: string;
  vsock: string;
  busy: boolean;
  idleTime: number;
}

export const warmPool = new Map<string, Vm[]>();

setInterval(
  async () => {
    const now = Date.now();

    for (const [id, vms] of warmPool.entries()) {
      const remainingvms = [];
      for (const vm of vms) {
        const isIdle = !vm.busy && now - vm.idleTime > 1000 * 60 * 10;

        if (isIdle) {
          vm.firecrackerProcess.kill("SIGTERM");
          await new Promise((res) => vm.firecrackerProcess.on("exit", res));
          await fs.promises.unlink(vm.apiSock);
          await fs.promises.unlink(vm.vsock);
          //warmPool.delete(id);
        } else {
          remainingvms.push(vm);
        }
      }
      if (remainingvms.length > 0) {
        warmPool.set(id, remainingvms);
      } else {
        warmPool.delete(id);
      }
    }
  },
  1000 * 60 * 5,
);
