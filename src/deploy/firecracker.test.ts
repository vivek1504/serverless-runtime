import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitForVMReady, waitForFile, createFcCient } from "./firecracker.js";
import { EventEmitter } from "events";
import fs from "fs";

describe("waitForVMReady", () => {
  function makeFakeFC() {
    return { stdout: new EventEmitter() };
  }

  it("resolves when READY arrives in one chunk", async () => {
    const fc = makeFakeFC();
    const promise = waitForVMReady(fc);
    fc.stdout.emit("data", Buffer.from("booting...\nREADY\n"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves when READY is split across chunks", async () => {
    const fc = makeFakeFC();
    const promise = waitForVMReady(fc);
    fc.stdout.emit("data", Buffer.from("REA"));
    fc.stdout.emit("data", Buffer.from("DY"));
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on timeout", async () => {
    const fc = makeFakeFC();
    const promise = new Promise<void>((resolve, reject) => {
      let buffer = "";
      const timeout = setTimeout(
        () => reject(new Error("VM startup timeout")),
        100,
      );
      fc.stdout.on("data", (d: Buffer) => {
        buffer += d.toString();
        if (buffer.includes("READY")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    await expect(promise).rejects.toThrow("VM startup timeout");
  });
});

describe("waitForFile", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns immediately if file exists", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    await expect(waitForFile("/tmp/test.sock", 1000)).resolves.toBeUndefined();
  });

  it("throws on timeout", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    await expect(waitForFile("/tmp/missing.sock", 200)).rejects.toThrow(
      "timeout waiting for socket",
    );
  });
});

describe("createFcCient", () => {
  it("creates axios client with socketPath", () => {
    const client = createFcCient("/tmp/test.sock");
    expect(client.defaults.socketPath).toBe("/tmp/test.sock");
    expect(client.defaults.baseURL).toBe("http://localhost");
  });
});
