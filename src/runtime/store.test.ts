import { describe, it, expect, beforeEach } from "vitest";
import { runtimeStore } from "./store.js";

describe("runtimeStore", () => {
  beforeEach(() => runtimeStore.reset());

  it("starts empty", () => {
    expect(runtimeStore.functions.size).toBe(0);
  });

  it("reset clears all functions", () => {
    runtimeStore.functions.set("test", {} as any);
    runtimeStore.reset();
    expect(runtimeStore.functions.size).toBe(0);
  });
});

