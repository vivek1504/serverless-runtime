import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupVm } from "./cleanup.js";
import fs from "fs";
import type { RuntimeFunction, Vm } from "../types/types.js";
import { Deque } from "./deque.js";

function makeVm(overrides = {}): Vm {
  return {
    id: "test",
    state: "ready",
    firecrackerProcess: { kill: vi.fn() } as any,
    apiSock: "/tmp/test-api.sock",
    vsock: "/tmp/test-vsock.sock",
    idleTime: Date.now(),
    ...overrides,
  };
}

function makeFn(vms: Vm[]): RuntimeFunction {
  const readyVms = new Set<Vm>(vms.filter((v) => v.state === "ready"));
  return {
    functionId: "fn1",
    queue: new Deque(),
    vms,
    readyVms,
    weight: 0,
    deficit: 0,
    inflightCount: 0,
    pendingCreations: 0,
  };
}

describe("cleanupVm", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("kills the process and removes sockets", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {});

    const vm = makeVm();
    const fn = makeFn([vm]);

    await cleanupVm(fn, vm);

    expect(vm.firecrackerProcess.kill).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fn.vms).toHaveLength(0);
  });

  it("skips if already cleaned", async () => {
    const vm = makeVm({ cleaned: true });
    const fn = makeFn([vm]);
    await cleanupVm(fn, vm);
    expect(vm.firecrackerProcess.kill).not.toHaveBeenCalled();
  });
});
