import express from "express";
import extractRouter from "./routes/extract.js";

const app = express();

app.use(express.json());

app.use("/extract", extractRouter);

app.listen(3000, () => {
    console.log("🚀 HTN API running on port 3000");
});