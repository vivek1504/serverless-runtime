import { describe, it, expect, vi } from "vitest";

vi.mock("../runtime/scheduler.js", () => ({
  enqueueRequest: vi.fn((functionId, task) => {
    // Simulate immediate error (no snapshot exists)
    task.reject(new Error("no snapshot"));
  }),
}));

import supertest from "supertest";
import { app } from "../app.js";

describe("Invoke route", () => {
  it("returns 500 when scheduler rejects", async () => {
    const res = await supertest(app).get("/f/test_function");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal server error");
  });
});

