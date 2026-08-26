import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`SET timezone = 'UTC'`);

  const res = await client.query(`
    SELECT "id", "externalId", status, "lastSeenAt", "updatedAt", "createdAt"
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'ACTIVE'
    LIMIT 3
  `);
  console.log("Columns:", Object.keys(res.rows[0]));
  console.log("Row 0:", JSON.stringify(res.rows[0], null, 2));
  console.log("Row 1 lastSeenAt type:", typeof res.rows[1]?.lastSeenAt);
  console.log("Row 1:", JSON.stringify(res.rows[1], null, 2));

  await client.end();
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
