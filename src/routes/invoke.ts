import { Router } from "express";
import { enqueueRequest } from "../runtime/scheduler.js";

export const invokeRouter = Router();

invokeRouter.use("/:functionId", async (req, res) => {
  try {
    await new Promise<void>((resolve, reject) => {
      enqueueRequest(req.params.functionId, {
        req,
        res,
        subPath: req.path || "/",
        resolve,
        reject,
      });
    });
  } catch (e) {
    console.error(e);

    if (!res.headersSent) {
      res.status(500).json({
        error: "internal server error",
      });
    }
  }
});
