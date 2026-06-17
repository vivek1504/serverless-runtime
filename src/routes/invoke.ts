import { Router } from "express";
import { enqueueRequest } from "../runtime/scheduler.js";
import { runtimeLogger } from "../utils/logger.js";
import { invocationTotal, invocationTime } from "../utils/metrics.js";

export const invokeRouter = Router();

invokeRouter.use("/:functionId", async (req, res) => {
  const { functionId } = req.params;
  const subPath = req.path || "/";
  const start = performance.now();

  runtimeLogger.info(
    { functionId, method: req.method, subPath },
    "function invocation received",
  );

  try {
    await new Promise<void>((resolve, reject) => {
      enqueueRequest(functionId, {
        req,
        res,
        subPath,
        resolve,
        reject,
        enqueuedAt: performance.now(),
      });
    });

    const durationSec = (performance.now() - start) / 1000;
    invocationTime.observe({ function_id: functionId }, durationSec);
    invocationTotal.inc({ function_id: functionId, status: "success" });

    runtimeLogger.info(
      { functionId, method: req.method, subPath, statusCode: res.statusCode, durationMs: durationSec * 1000 },
      "function invocation completed",
    );
  } catch (e: any) {
    const durationSec = (performance.now() - start) / 1000;
    invocationTime.observe({ function_id: functionId }, durationSec);
    invocationTotal.inc({ function_id: functionId, status: "error" });

    runtimeLogger.error(
      { functionId, method: req.method, subPath, err: e, durationMs: durationSec * 1000 },
      "function invocation failed",
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: "internal server error",
      });
    }
  }
});
