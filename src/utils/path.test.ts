import { describe, it, expect } from "vitest";
import { getPaths } from "./path.js";
import path from "path";

describe("getPaths", () => {
  const id = "abc123";
  const result = getPaths(id);

  it("returns the functionId", () => {
    expect(result.functionId).toBe(id);
  });

  it("builds correct outputDir under extracted/", () => {
    expect(result.outputDir).toBe(path.join(path.resolve("extracted"), id));
  });

  it("builds correct socket paths in /tmp", () => {
    expect(result.apiSock).toBe(`/tmp/firecracker-${id}.socket`);
    expect(result.vsock).toBe(`/tmp/vsock-${id}.sock`);
  });

  it("builds correct rootfs path", () => {
    expect(result.rootfs).toBe(path.resolve(`rootfs/rootfs-${id}.ext4`));
  });

  it("builds correct snapshot and memory paths", () => {
    expect(result.snapshot).toBe(path.resolve(`snapshot/snapshot-${id}`));
    expect(result.memory).toBe(path.resolve(`mem/mem-${id}`));
  });
});
