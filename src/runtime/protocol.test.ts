import { describe, it, expect } from "vitest";
import { buildPayload, readVsockResponse } from "./protocol.js";
import { PassThrough } from "stream";
import type { Socket } from "net";

describe("buildPayload", () => {
  it("serializes request into JSON with newline", () => {
    const req = {
      method: "POST",
      headers: { "content-type": "application/json" },
      query: { page: "1" },
      body: { name: "test" },
    };

    const result = buildPayload(req, "/greet");
    const parsed = JSON.parse(result.trim());

    expect(parsed.httpMethod).toBe("POST");
    expect(parsed.path).toBe("/greet");
    expect(parsed.headers["content-type"]).toBe("application/json");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("defaults body to empty object when undefined", () => {
    const req = { method: "GET", headers: {}, query: {} };
    const parsed = JSON.parse(buildPayload(req, "/").trim());
    expect(parsed.body).toBe("{}");
  });
});

describe("readVsockResponse", () => {
  function makeFakeSocket() {
    return new PassThrough() as unknown as Socket;
  }

  it("resolves on a valid response message", async () => {
    const socket = makeFakeSocket();
    const promise = readVsockResponse(socket, 5000);

    socket.push(
      JSON.stringify({
        type: "response",
        data: { statusCode: 200, body: "ok" },
      }) + "\n",
    );

    const msg = await promise;
    expect(msg.type).toBe("response");
    expect(msg.data.statusCode).toBe(200);
  });

  it("resolves on an error message", async () => {
    const socket = makeFakeSocket();
    const promise = readVsockResponse(socket, 5000);

    socket.push(
      JSON.stringify({ type: "error", data: null, error: "boom" }) + "\n",
    );

    const msg = await promise;
    expect(msg.type).toBe("error");
    expect(msg.error).toBe("boom");
  });

  it("skips OK lines and waits for real response", async () => {
    const socket = makeFakeSocket();
    const promise = readVsockResponse(socket, 5000);

    socket.push("OK\n");
    socket.push(
      JSON.stringify({ type: "response", data: { statusCode: 201 } }) + "\n",
    );

    const msg = await promise;
    expect(msg.data.statusCode).toBe(201);
  });

  it("rejects on timeout", async () => {
    const socket = makeFakeSocket();
    (socket as any).destroy = () => socket.end();

    await expect(readVsockResponse(socket, 100)).rejects.toThrow(
      "Function timeout",
    );
  });
});
