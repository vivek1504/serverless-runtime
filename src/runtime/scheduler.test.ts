import { describe, it, expect, vi, beforeEach } from "vitest";
import { runtimeStore } from "./store.js";
import type { RequestTask } from "../types/types.js";

vi.mock("./vm-manager.js", () => ({
  createVm: vi.fn(async (fid, fn) => {
    const vm = { id: "mock", state: "ready", idleTime: Date.now() };
    fn.vms.push(vm);
    return vm;
  }),
}));

vi.mock("./transport.js", () => ({
  sendRequest: vi.fn(async () => {}),
}));

import { enqueueRequest } from "./scheduler.js";
import { sendRequest } from "./transport.js";

describe("scheduler", () => {
  beforeEach(() => {
    runtimeStore.functions.clear();
    vi.clearAllMocks();
  });

  it("creates a function entry on first request", async () => {
    const task = makeTask();
    enqueueRequest("fn1", task);
    await task.promise;
    expect(runtimeStore.functions.has("fn1")).toBe(true);
  });

  it("calls sendRequest with correct args", async () => {
    const task = makeTask("/hello");
    enqueueRequest("fn1", task);
    await task.promise;
    expect(sendRequest).toHaveBeenCalledWith("/hello", task.req, task.res, expect.anything());
  });

  it("rejects task when sendRequest throws", async () => {
    (sendRequest as any).mockRejectedValueOnce(new Error("boom"));
    const task = makeTask();
    enqueueRequest("fn1", task);
    await expect(task.promise).rejects.toThrow("boom");
  });
});

function makeTask(subPath = "/"): RequestTask & { promise: Promise<void> } {
  let resolve!: () => void;
  let reject!: (err: any) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  const req = { method: "GET", headers: {}, query: {}, body: {} };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() };
  return { req, res, subPath, resolve, reject, promise } as any;
}

