import { describe, it, expect } from "vitest";
import { jobs, deployQueue } from "./queue.js";
import type { JobStatus } from "./queue.js";

describe("deploy queue", () => {
  it("jobs map starts empty", () => {
    expect(jobs.size).toBe(0);
  });

  it("deployQueue has concurrency 3", () => {
    expect(deployQueue.concurrency).toBe(3);
  });

  it("can track job lifecycle", () => {
    jobs.set("j1", { state: "pending" });
    expect(jobs.get("j1")?.state).toBe("pending");

    jobs.set("j1", { state: "running" });
    expect(jobs.get("j1")?.state).toBe("running");

    jobs.set("j1", { state: "done", functionId: "f1", url: "/f/f1" });
    const job = jobs.get("j1") as Extract<JobStatus, { state: "done" }>;
    expect(job.functionId).toBe("f1");

    jobs.delete("j1");
  });
});

