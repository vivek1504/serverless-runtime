import { runtimeStore } from "./store.js";
import { createVm } from "./vm-manager.js";
import { sendRequest } from "./transport.js";

import type { RequestTask, RuntimeFunction } from "../types/types.js";

const MAX_VMS = 100;

export async function enqueueRequest(functionId: string, task: RequestTask) {
  let fn = runtimeStore.functions.get(functionId);

  if (!fn) {
    fn = {
      functionId,

      queue: [],

      vms: [],

      processing: false,
    };

    runtimeStore.functions.set(functionId, fn);
  }

  fn.queue.push(task);

  processQueue(fn);
}

async function processQueue(fn: RuntimeFunction) {
  if (fn.processing) return;

  fn.processing = true;

  try {
    while (fn.queue.length > 0) {
      let vm = fn.vms.find((v) => v.state === "ready");

      if (!vm && fn.vms.length < MAX_VMS) {
        vm = await createVm(fn.functionId, fn);
      }

      if (!vm) return;

      const task = fn.queue.shift();

      if (!task) return;

      vm.state = "busy";

      try {
        await sendRequest(task.subPath, task.req, task.res, vm);

        task.resolve();
      } catch (err) {
        task.reject(err);
      } finally {
        vm.state = "ready";
        vm.idleTime = Date.now();
      }
    }
  } finally {
    fn.processing = false;
  }
}
