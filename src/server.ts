import express from "express";
import { deployRouter } from "./routes/deploy.js";
import { invokeRouter } from "./routes/invoke.js";

const app = express();
app.use(express.json());

app.use("/deploy", deployRouter);
app.use("/f", invokeRouter);

app.listen(3000, () => {
  console.log("listen");
});
