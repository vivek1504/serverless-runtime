import { runtimeStore } from "./store.js";
import { createVm } from "./vm-manager.js";
import { sendRequest } from "./transport.js";
import { schedulerLogger } from "../utils/logger.js";

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
    schedulerLogger.info({ functionId }, "new runtime function registered");
  }

  fn.queue.push(task);
  schedulerLogger.debug(
    { functionId, queueDepth: fn.queue.length },
    "request enqueued",
  );

  processQueue(fn);
}

async function processQueue(fn: RuntimeFunction) {
  if (fn.processing) return;
  fn.processing = true;

  try {
    while (fn.queue.length > 0) {
      let vm = fn.vms.find((v) => v.state === "ready");

      if (!vm && fn.vms.length < MAX_VMS) {
        schedulerLogger.info(
          { functionId: fn.functionId, currentVms: fn.vms.length },
          "creating new VM",
        );
        vm = await createVm(fn.functionId, fn);
      }

      if (!vm) {
        schedulerLogger.warn(
          { functionId: fn.functionId, vmCount: fn.vms.length },
          "no VM available, max reached",
        );
        return;
      }

      const task = fn.queue.shift();
      if (!task) return;

      vm.state = "busy";
      schedulerLogger.debug(
        { functionId: fn.functionId, vmId: vm.id, subPath: task.subPath },
        "dispatching request to VM",
      );

      try {
        await sendRequest(task.subPath, task.req, task.res, vm);
        task.resolve();
      } catch (err) {
        schedulerLogger.error(
          { functionId: fn.functionId, vmId: vm.id, err },
          "request handling failed",
        );
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
