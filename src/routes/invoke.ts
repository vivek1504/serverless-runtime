import { Router } from "express";
import { enqueueRequest } from "../runtime/scheduler.js";
import { runtimeLogger } from "../utils/logger.js";

export const invokeRouter = Router();

invokeRouter.use("/:functionId", async (req, res) => {
  const { functionId } = req.params;
  const subPath = req.path || "/";

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
      });
    });

    runtimeLogger.info(
      { functionId, method: req.method, subPath, statusCode: res.statusCode },
      "function invocation completed",
    );
  } catch (e: any) {
    runtimeLogger.error(
      { functionId, method: req.method, subPath, err: e },
      "function invocation failed",
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: "internal server error",
      });
    }
  }
});
