import "dotenv/config";

import app from "./app.js";
import { startHtnAtsCandidateSyncWorker } from "./workers/htn-ats-candidate-sync.worker.js";
import { startHtnAtsSyncWorker } from "./workers/htn-ats-sync.worker.js";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`🚀 HTN API running on port ${PORT}`);
    console.log("NOTION_TOKEN:", process.env.NOTION_TOKEN);
    startHtnAtsSyncWorker();
    startHtnAtsCandidateSyncWorker();
});