import express from "express";
import cors from "cors";

import extractRouter from "./routes/extract.js";
import jobsRouter from "./routes/jobs.js";

const app = express();

app.use(cors());

app.use(express.json({
    limit: "20mb"
}));

app.use("/extract", extractRouter);
app.use("/api/jobs", jobsRouter);

export default app;