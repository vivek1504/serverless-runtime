import { runtimeStore } from "./store.js";
import { createVm } from "./vm-manager.js";
import { sendRequest } from "./transport.js";
import { schedulerLogger } from "../utils/logger.js";
import {
  invocationQueueDepth,
  schedulerEnqueueDuration,
  schedulerDrainCycleDuration,
  schedulerDispatchDuration,
  schedulerVmLookupDuration,
  schedulerVmProvisionDuration,
  schedulerDrainIterations,
  schedulerQueueWaitTime,
} from "../utils/metrics.js";
import { Deque } from "./deque.js";

import type { RequestTask, RuntimeFunction, Vm } from "../types/types.js";

const MAX_GLOBAL_VMS = 200;
const MAX_PENDING_PER_FN = 4;
const QUANTUM = 1;

const DISPATCH_BATCH_SIZE = 512;

const perfLog = schedulerLogger;

let globalProcessing = false;
let rescheduleNeeded = false;
let totalVmCount = 0;
let pendingVmCreations = 0;

const activeFunctions = new Set<RuntimeFunction>();

export function enqueueRequest(functionId: string, task: RequestTask) {
  const t0 = performance.now();

  let fn = runtimeStore.functions.get(functionId);

  if (!fn) {
    fn = {
      functionId,
      queue: new Deque<RequestTask>(),
      vms: [],
      readyVms: new Set(),
      weight: 1,
      inflightCount: 0,
      deficit: 0,
      pendingCreations: 0,
    };
    runtimeStore.functions.set(functionId, fn);
    schedulerLogger.info({ functionId }, "new runtime function registered");
  }

  fn.queue.push(task);
  activeFunctions.add(fn);
  invocationQueueDepth.inc({ function_id: functionId });

  const enqueueDurationMs = performance.now() - t0;
  schedulerEnqueueDuration.observe(enqueueDurationMs / 1000);
  perfLog.debug(
    {
      functionId,
      queueDepth: fn.queue.length,
      enqueueDurationMs: round(enqueueDurationMs),
    },
    "perf:enqueue",
  );

  scheduleGlobal();
}

function scheduleGlobal() {
  if (globalProcessing) {
    rescheduleNeeded = true;
    return;
  }
  globalProcessing = true;

  try {
    drainBatch();
  } finally {
    globalProcessing = false;
  }

  if (rescheduleNeeded) {
    rescheduleNeeded = false;
    scheduleGlobal();
  }
}

function drainBatch() {
  const drainStart = performance.now();
  let dispatched: boolean;
  let iterations = 0;

  do {
    dispatched = false;
    rescheduleNeeded = false;

    for (const fn of activeFunctions) {
      if (fn.queue.length === 0) {
        fn.deficit = 0;
        activeFunctions.delete(fn);
        continue;
      }

      fn.deficit += fn.weight * QUANTUM;

      while (fn.deficit > 0 && fn.queue.length > 0) {
        const lookupStart = performance.now();
        const vm = pickReadyVm(fn);
        const lookupDurationMs = performance.now() - lookupStart;
        schedulerVmLookupDuration.observe(lookupDurationMs / 1000);

        if (!vm) {
          perfLog.debug(
            {
              functionId: fn.functionId,
              readyVms: fn.readyVms.size,
              totalVms: fn.vms.length,
              lookupDurationMs: round(lookupDurationMs),
            },
            "perf:vm_lookup_miss",
          );
          maybeProvisionVm(fn);
          break;
        }

        const dispatchStart = performance.now();

        const task = fn.queue.shift()!;
        fn.deficit -= 1;
        markVmBusy(fn, vm);
        fn.inflightCount += 1;
        invocationQueueDepth.dec({ function_id: fn.functionId });
        dispatched = true;

        const dispatchOverheadMs = performance.now() - dispatchStart;
        schedulerDispatchDuration.observe(dispatchOverheadMs / 1000);

        const queueWaitMs = performance.now() - task.enqueuedAt;
        schedulerQueueWaitTime.observe(
          { function_id: fn.functionId },
          queueWaitMs / 1000,
        );

        perfLog.debug(
          {
            functionId: fn.functionId,
            vmId: vm.id,
            subPath: task.subPath,
            queueWaitMs: round(queueWaitMs),
            lookupDurationMs: round(lookupDurationMs),
            dispatchOverheadMs: round(dispatchOverheadMs),
            queueRemaining: fn.queue.length,
            readyVmsRemaining: fn.readyVms.size,
          },
          "perf:dispatch",
        );

        dispatchTask(fn, vm, task);

        iterations++;
        if (iterations >= DISPATCH_BATCH_SIZE) {
          const drainDurationMs = performance.now() - drainStart;
          schedulerDrainCycleDuration.observe(drainDurationMs / 1000);
          schedulerDrainIterations.observe(iterations);
          perfLog.debug(
            {
              iterations,
              drainDurationMs: round(drainDurationMs),
              yielding: true,
            },
            "perf:drain_batch_yield",
          );

          if (hasMoreWork()) {
            setImmediate(() => {
              globalProcessing = true;
              try {
                drainBatch();
              } finally {
                globalProcessing = false;
              }
              if (rescheduleNeeded) {
                rescheduleNeeded = false;
                scheduleGlobal();
              }
            });
          }
          return;
        }
      }

      if (fn.queue.length === 0) {
        fn.deficit = 0;
        activeFunctions.delete(fn);
      }
    }
  } while (dispatched || rescheduleNeeded);

  const drainDurationMs = performance.now() - drainStart;
  schedulerDrainCycleDuration.observe(drainDurationMs / 1000);
  schedulerDrainIterations.observe(iterations);

  if (iterations > 0) {
    perfLog.debug(
      {
        iterations,
        drainDurationMs: round(drainDurationMs),
        activeFunctions: activeFunctions.size,
        yielding: false,
      },
      "perf:drain_batch_complete",
    );
  }
}

function pickReadyVm(fn: RuntimeFunction): Vm | undefined {
  for (const vm of fn.readyVms) {
    return vm;
  }
  return undefined;
}

function markVmBusy(fn: RuntimeFunction, vm: Vm) {
  vm.state = "busy";
  fn.readyVms.delete(vm);
}

function markVmReady(fn: RuntimeFunction, vm: Vm) {
  vm.state = "ready";
  vm.idleTime = Date.now();
  fn.readyVms.add(vm);
}

function hasMoreWork(): boolean {
  for (const fn of activeFunctions) {
    if (fn.queue.length > 0) return true;
  }
  return false;
}

async function dispatchTask(fn: RuntimeFunction, vm: Vm, task: RequestTask) {
  const taskStart = performance.now();

  try {
    const sendStart = performance.now();
    await sendRequest(task.subPath, task.req, task.res, vm);
    const sendDurationMs = performance.now() - sendStart;

    task.resolve();

    const totalMs = performance.now() - taskStart;
    perfLog.debug(
      {
        functionId: fn.functionId,
        vmId: vm.id,
        subPath: task.subPath,
        sendRequestMs: round(sendDurationMs),
        totalTaskMs: round(totalMs),
      },
      "perf:task_complete",
    );
  } catch (err) {
    const totalMs = performance.now() - taskStart;
    schedulerLogger.error(
      {
        functionId: fn.functionId,
        vmId: vm.id,
        err,
        totalTaskMs: round(totalMs),
      },
      "request handling failed",
    );
    task.reject(err);
  } finally {
    markVmReady(fn, vm);
    fn.inflightCount -= 1;
    scheduleGlobal();
  }
}

function maybeProvisionVm(fn: RuntimeFunction) {
  if (totalVmCount + pendingVmCreations >= MAX_GLOBAL_VMS) {
    schedulerLogger.warn(
      { functionId: fn.functionId, totalVmCount, pendingVmCreations },
      "global VM limit reached, cannot provision",
    );
    return;
  }

  if (fn.pendingCreations >= MAX_PENDING_PER_FN) return;

  fn.pendingCreations += 1;
  pendingVmCreations += 1;

  const provisionStart = performance.now();
  schedulerLogger.info(
    { functionId: fn.functionId, totalVmCount, pendingVmCreations },
    "provisioning new VM asynchronously",
  );

  createVm(fn.functionId, fn)
    .then(() => {
      totalVmCount += 1;
      const newVm = fn.vms[fn.vms.length - 1];
      if (newVm && newVm.state === "ready") {
        fn.readyVms.add(newVm);
      }

      const provisionDurationMs = performance.now() - provisionStart;
      schedulerVmProvisionDuration.observe(provisionDurationMs / 1000);

      perfLog.info(
        {
          functionId: fn.functionId,
          totalVmCount,
          provisionDurationMs: round(provisionDurationMs),
        },
        "perf:vm_provision_complete",
      );
    })
    .catch((err) => {
      const provisionDurationMs = performance.now() - provisionStart;
      schedulerVmProvisionDuration.observe(provisionDurationMs / 1000);

      schedulerLogger.error(
        {
          functionId: fn.functionId,
          err,
          provisionDurationMs: round(provisionDurationMs),
        },
        "async VM provisioning failed",
      );
    })
    .finally(() => {
      fn.pendingCreations -= 1;
      pendingVmCreations -= 1;
      scheduleGlobal();
    });
}

export function notifyVmDestroyed() {
  totalVmCount = Math.max(0, totalVmCount - 1);
  scheduleGlobal();
}

export function resetSchedulerState() {
  globalProcessing = false;
  rescheduleNeeded = false;
  totalVmCount = 0;
  pendingVmCreations = 0;
  activeFunctions.clear();
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}
