import { Router } from "express";
import crypto from "crypto";
import { upload } from "../deploy/upload.js";
import { jobs, deployQueue } from "../deploy/queue.js";
import { deployFunction } from "../deploy/pipeline.js";
import { deployLogger } from "../utils/logger.js";

export const deployRouter = Router();

deployRouter.post("/", upload.single("code"), async (req, res) => {
  if (!req.file?.path) {
    deployLogger.warn("deploy request rejected: no file uploaded");
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (deployQueue.size > 50) {
    deployLogger.warn(
      { queueSize: deployQueue.size },
      "deploy request rejected: queue full",
    );
    return res.status(429).json({ error: "Too many jobs" });
  }

  const jobId = crypto.randomBytes(8).toString("hex");
  jobs.set(jobId, { state: "pending" });

  deployLogger.info(
    {
      jobId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      queueSize: deployQueue.size + 1,
    },
    "deployment job enqueued",
  );

  deployQueue.add(async () => {
    jobs.set(jobId, { state: "running" });
    deployLogger.info({ jobId }, "deployment job started");

    try {
      const result = await deployFunction(req.file!.path);
      jobs.set(jobId, {
        state: "done",
        functionId: result.functionId,
        url: result.url,
      });
      deployLogger.info(
        { jobId, functionId: result.functionId, url: result.url },
        "deployment job completed successfully",
      );
    } catch (err: any) {
      jobs.set(jobId, { state: "error", message: err.message });
      deployLogger.error(
        { jobId, err },
        "deployment job failed",
      );
    }
  });

  res.status(202).json({
    jobId,
    statusUrl: `http://localhost:3000/deploy/status/${jobId}`,
  });
});

deployRouter.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    deployLogger.debug({ jobId: req.params.jobId }, "status lookup: unknown job");
    return res.status(404).json({ error: "Unknown job" });
  }
  deployLogger.debug({ jobId: req.params.jobId, state: job.state }, "status lookup");
  res.json(job);
});
