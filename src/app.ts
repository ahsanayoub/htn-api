import express from "express";
import cors from "cors";

import jobsRouter from "./routes/jobs.js";
import applicationsRouter from "./routes/applications.js";

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "20mb",
  }),
);

app.use("/api/jobs", jobsRouter);
app.use("/api/applications", applicationsRouter);

export default app;
