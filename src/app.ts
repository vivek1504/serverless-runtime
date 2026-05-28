import express from "express";
import pinoHttp from "pino-http";
import { deployRouter } from "./routes/deploy.js";
import { invokeRouter } from "./routes/invoke.js";
import { httpLoggerOptions } from "./utils/logger.js";

export const app = express();

// @ts-expect-error
app.use(pinoHttp(httpLoggerOptions));
app.use(express.json());
app.use("/deploy", deployRouter);
app.use("/f", invokeRouter);
