import { runtimeStore } from "./store.js";
import { createVm } from "./vm-manager.js";
import { sendRequest } from "./transport.js";
import { schedulerLogger } from "../utils/logger.js";
import { invocationQueueDepth } from "../utils/metrics.js";

import type { RequestTask, RuntimeFunction, Vm } from "../types/types.js";

const MAX_GLOBAL_VMS = 100;
const QUANTUM = 1;
let globalProcessing = false;
const vmsPendingCreation = new Set<string>();

export async function enqueueRequest(functionId: string, task: RequestTask) {
  let fn = runtimeStore.functions.get(functionId);

  if (!fn) {
    fn = {
      functionId,
      queue: [],
      vms: [],
      weight: 1,
      inflightCount: 0,
      deficit: 0,
    };
    runtimeStore.functions.set(functionId, fn);
    schedulerLogger.info({ functionId }, "new runtime function registered");
  }

  fn.queue.push(task);
  invocationQueueDepth.inc({ function_id: functionId });
  schedulerLogger.debug(
    { functionId, queueDepth: fn.queue.length },
    "request enqueued",
  );

  scheduleGlobal();
}

function scheduleGlobal() {
  if (globalProcessing) return;
  globalProcessing = true;

  try {
    let dispatched: boolean;

    do {
      dispatched = false;

      for (const fn of runtimeStore.functions.values()) {
        if (fn.queue.length === 0) {
          fn.deficit = 0;
          continue;
        }

        fn.deficit += fn.weight * QUANTUM;

        while (fn.deficit > 0 && fn.queue.length > 0) {
          const vm = fn.vms.find((v) => v.state === "ready");

          if (!vm) {
            maybeProvisionVm(fn);
            break;
          }

          const task = fn.queue.shift()!;
          fn.deficit -= 1;
          vm.state = "busy";
          fn.inflightCount += 1;
          invocationQueueDepth.dec({ function_id: fn.functionId });
          dispatched = true;

          schedulerLogger.debug(
            { functionId: fn.functionId, vmId: vm.id, subPath: task.subPath },
            "dispatching request to VM",
          );

          dispatchTask(fn, vm, task);
        }

        if (fn.queue.length === 0) {
          fn.deficit = 0;
        }
      }
    } while (dispatched);
  } finally {
    globalProcessing = false;
  }
}

async function dispatchTask(fn: RuntimeFunction, vm: Vm, task: RequestTask) {
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
    fn.inflightCount -= 1;

    scheduleGlobal();
  }
}

function maybeProvisionVm(fn: RuntimeFunction) {
  const totalVms = getTotalVmCount();
  const pendingCount = vmsPendingCreation.size;

  if (totalVms + pendingCount >= MAX_GLOBAL_VMS) {
    schedulerLogger.warn(
      { functionId: fn.functionId, totalVms, pendingCount },
      "global VM limit reached, cannot provision",
    );
    return;
  }

  if (vmsPendingCreation.has(fn.functionId)) return;

  vmsPendingCreation.add(fn.functionId);
  schedulerLogger.info(
    { functionId: fn.functionId, totalVms },
    "provisioning new VM asynchronously",
  );

  createVm(fn.functionId, fn)
    .then(() => {
      schedulerLogger.info(
        { functionId: fn.functionId },
        "async VM provisioning complete",
      );
    })
    .catch((err) => {
      schedulerLogger.error(
        { functionId: fn.functionId, err },
        "async VM provisioning failed",
      );
    })
    .finally(() => {
      vmsPendingCreation.delete(fn.functionId);
      scheduleGlobal();
    });
}

function getTotalVmCount(): number {
  let total = 0;
  for (const fn of runtimeStore.functions.values()) {
    total += fn.vms.length;
  }
  return total;
}
