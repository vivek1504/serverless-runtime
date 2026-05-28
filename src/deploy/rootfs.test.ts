import { describe, it, expect, vi } from "vitest";
import { extractZip } from "./rootfs.js";

vi.mock("extract-zip", () => ({
  default: vi.fn(async (zip, opts) => {
    if (opts?.onEntry) {
      opts.onEntry({ fileName: "index.js" });
    }
  }),
}));

describe("extractZip", () => {
  it("calls extract with correct args", async () => {
    const extract = (await import("extract-zip")).default;
    await extractZip("/tmp/code.zip", "/tmp/output");
    expect(extract).toHaveBeenCalledWith(
      "/tmp/code.zip",
      expect.objectContaining({
        dir: "/tmp/output",
      }),
    );
  });

  it("rejects zip entries with path traversal", async () => {
    const extract = (await import("extract-zip")).default;
    (extract as any).mockImplementation(async (_: any, opts: any) => {
      opts.onEntry({ fileName: "../../etc/passwd" });
    });
    await expect(extractZip("/tmp/evil.zip", "/tmp/out")).rejects.toThrow(
      "Invalid zip content",
    );
  });
});
