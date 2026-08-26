import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`SET timezone = 'UTC'`);

  const counts = await client.query(
    `SELECT status, COUNT(*) as cnt FROM "Job" WHERE source = 'MICRO1' GROUP BY status ORDER BY status`
  );
  console.log("=== DB COUNT BY STATUS ===");
  for (const row of counts.rows) {
    console.log(`  ${row.status}: ${row.cnt}`);
  }

  const total = await client.query(
    `SELECT COUNT(*) as cnt FROM "Job" WHERE source = 'MICRO1'`
  );
  console.log(`TOTAL: ${total.rows[0].cnt}`);

  const intCurrent = await client.query(
    `SELECT id, "externalId", title, status, "lastSeenAt", "updatedAt", "createdAt" FROM "Job" WHERE source = 'MICRO1' AND "externalId" = 'int-current'`
  );
  console.log("=== int-current ===");
  if (intCurrent.rows.length === 0) {
    console.log("NOT FOUND");
  } else {
    console.log(JSON.stringify(intCurrent.rows[0], null, 2));
  }

  await client.end();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
