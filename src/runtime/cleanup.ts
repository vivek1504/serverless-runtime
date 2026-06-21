import fs from "fs";
import { cleanupLogger } from "../utils/logger.js";
import { vmCleanupTotal, vmCount } from "../utils/metrics.js";
import { notifyVmDestroyed } from "./scheduler.js";

import type { RuntimeFunction, Vm } from "../types/types.js";

export async function cleanupVm(fn: RuntimeFunction, vm: Vm) {
  if (vm.cleaned) return;

  vm.cleaned = true;
  cleanupLogger.info(
    { functionId: fn.functionId, vmId: vm.id },
    "cleaning up VM",
  );

  try {
    vm.firecrackerProcess.kill();
    cleanupLogger.debug({ vmId: vm.id }, "firecracker process killed");
  } catch {}

  try {
    if (fs.existsSync(vm.apiSock)) {
      fs.unlinkSync(vm.apiSock);
      cleanupLogger.debug({ path: vm.apiSock }, "API socket removed");
    }

    if (fs.existsSync(vm.vsock)) {
      fs.unlinkSync(vm.vsock);
      cleanupLogger.debug({ path: vm.vsock }, "vsock removed");
    }
  } catch {}

  fn.vms = fn.vms.filter((v) => v !== vm);
  fn.readyVms.delete(vm);
  vmCleanupTotal.inc();
  vmCount.dec({ function_id: fn.functionId, state: vm.state });
  notifyVmDestroyed();

  cleanupLogger.info(
    { functionId: fn.functionId, vmId: vm.id, remainingVms: fn.vms.length },
    "VM cleanup completed",
  );
}
