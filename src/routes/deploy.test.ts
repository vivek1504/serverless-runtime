import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../deploy/pipeline.js", () => ({
  deployFunction: vi.fn(),
}));

import supertest from "supertest";
import { app } from "../app.js";

describe("POST /deploy", () => {
  it("returns 400 when no file is uploaded", async () => {
    const res = await supertest(app).post("/deploy");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });
});

describe("GET /deploy/status/:jobId", () => {
  it("returns 404 for unknown job", async () => {
    const res = await supertest(app).get("/deploy/status/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/unknown/i);
  });
});
