import fs from "fs";

import type { RuntimeFunction, Vm } from "../types/types.js";

export async function cleanupVm(fn: RuntimeFunction, vm: Vm) {
  if (vm.cleaned) return;

  vm.cleaned = true;

  try {
    vm.firecrackerProcess.kill();
  } catch {}

  try {
    if (fs.existsSync(vm.apiSock)) {
      fs.unlinkSync(vm.apiSock);
    }

    if (fs.existsSync(vm.vsock)) {
      fs.unlinkSync(vm.vsock);
    }
  } catch {}

  fn.vms = fn.vms.filter((v) => v !== vm);
}
