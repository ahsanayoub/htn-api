import 'dotenv/config';
import pg from 'pg';

function toUTC(dt: Date | string): string {
  const d = new Date(dt);
  return d.toISOString();
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database');

  // 1. Current status distribution
  console.log('\n=== 1. Current MICRO1 status distribution ===');
  const r1 = await client.query(`
    SELECT status, COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1'
    GROUP BY status
    ORDER BY status
  `);
  console.log(JSON.stringify(r1.rows, null, 2));

  const r1b = await client.query(`
    SELECT COUNT(*) as total FROM "Job" WHERE source = 'MICRO1'
  `);
  console.log('Total MICRO1:', JSON.stringify(r1b.rows[0], null, 2));

  // 2. CLOSED jobs by lastSeenAt NULL/populated, then grouped by time
  console.log('\n=== 2. CLOSED MICRO1 jobs by lastSeenAt NULL/populated ===');
  const r2 = await client.query(`
    SELECT
      CASE WHEN "lastSeenAt" IS NULL THEN 'NULL' ELSE 'POPULATED' END as lastSeenGroup,
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED'
    GROUP BY 1
    ORDER BY 1
  `);
  console.log(JSON.stringify(r2.rows, null, 2));

  console.log('\n=== 2b. CLOSED MICRO1 jobs with populated lastSeenAt, grouped by date ===');
  const r2b = await client.query(`
    SELECT
      DATE("lastSeenAt") as seen_date,
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED' AND "lastSeenAt" IS NOT NULL
    GROUP BY DATE("lastSeenAt")
    ORDER BY seen_date
  `);
  console.log(JSON.stringify(r2b.rows, null, 2));

  console.log('\n=== 2c. CLOSED MICRO1 jobs with populated lastSeenAt, grouped by hour ===');
  const r2c = await client.query(`
    SELECT
      "lastSeenAt" as last_seen_at,
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED' AND "lastSeenAt" IS NOT NULL
    GROUP BY "lastSeenAt"
    ORDER BY cnt DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(r2c.rows, null, 2));

  // 3. 20 most recently updated CLOSED jobs
  console.log('\n=== 3. 20 most recently CLOSED MICRO1 jobs (by updatedAt DESC) ===');
  const r3 = await client.query(`
    SELECT id, "externalId", title, status, "lastSeenAt", "updatedAt", "createdAt"
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED'
    ORDER BY "updatedAt" DESC
    LIMIT 20
  `);
  for (const row of r3.rows) {
    console.log(JSON.stringify({
      id: row.id,
      externalId: row.externalId,
      title: row.title,
      status: row.status,
      lastSeenAt: toUTC(row.lastSeenAt),
      updatedAt: toUTC(row.updatedAt),
      createdAt: toUTC(row.createdAt),
    }));
  }

  // 4. All 16 ACTIVE MICRO1 jobs
  console.log('\n=== 4. All 16 ACTIVE MICRO1 jobs ===');
  const r4 = await client.query(`
    SELECT id, "externalId", title, status, "lastSeenAt", "updatedAt", "createdAt"
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'ACTIVE'
    ORDER BY "updatedAt" DESC
  `);
  for (const row of r4.rows) {
    console.log(JSON.stringify({
      id: row.id,
      externalId: row.externalId,
      title: row.title,
      status: row.status,
      lastSeenAt: toUTC(row.lastSeenAt),
      updatedAt: toUTC(row.updatedAt),
      createdAt: toUTC(row.createdAt),
    }));
  }

  // 5. SourceSync records for MICRO1
  console.log('\n=== 5. SourceSync records for MICRO1 ===');
  const r5 = await client.query(`
    SELECT id, source, "lastSyncStart", "lastSyncAt",
           "totalSeen", "totalCreated", "totalUpdated", "totalFailed",
           "createdAt" as ss_created_at, "updatedAt" as ss_updated_at
    FROM "SourceSync"
    WHERE source = 'MICRO1'
    ORDER BY "lastSyncAt" DESC
  `);
  console.log(JSON.stringify(r5.rows, null, 2));

  // 5b. ALL SourceSync records
  console.log('\n=== 5b. ALL SourceSync records ===');
  const r5b = await client.query(`
    SELECT id, source, "lastSyncStart", "lastSyncAt",
           "totalSeen", "totalCreated", "totalUpdated", "totalFailed",
           "createdAt" as ss_created_at, "updatedAt" as ss_updated_at
    FROM "SourceSync"
    ORDER BY "lastSyncAt" DESC
  `);
  console.log(JSON.stringify(r5b.rows, null, 2));

  // 6. Closure clusters - group CLOSED jobs by updatedAt timestamp
  console.log('\n=== 6. Major closure clusters (updatedAt groups for CLOSED MICRO1) ===');
  const r6 = await client.query(`
    SELECT
      "updatedAt",
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED'
    GROUP BY "updatedAt"
    ORDER BY cnt DESC, "updatedAt" DESC
  `);
  console.log(JSON.stringify(r6.rows, null, 2));

  // 6b. Closure clusters rounded to seconds (to catch near-identical timestamps)
  console.log('\n=== 6b. Closure clusters (rounded to 1-second buckets) ===');
  const r6b = await client.query(`
    SELECT
      DATE_TRUNC('second', "updatedAt") as second_bucket,
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED'
    GROUP BY DATE_TRUNC('second', "updatedAt")
    ORDER BY cnt DESC, second_bucket DESC
  `);
  console.log(JSON.stringify(r6b.rows, null, 2));

  // 6c. Closure clusters rounded to minutes (broader view)
  console.log('\n=== 6c. Closure clusters (rounded to 1-minute buckets) ===');
  const r6c = await client.query(`
    SELECT
      DATE_TRUNC('minute', "updatedAt") as minute_bucket,
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'CLOSED'
    GROUP BY DATE_TRUNC('minute', "updatedAt")
    ORDER BY minute_bucket DESC
  `);
  console.log(JSON.stringify(r6c.rows, null, 2));

  // 7. Also show ALL MICRO1 jobs grouped by updatedAt bucket and status
  console.log('\n=== 7. All MICRO1 jobs: updatedAt minute buckets x status ===');
  const r7 = await client.query(`
    SELECT
      DATE_TRUNC('minute', "updatedAt") as minute_bucket,
      status,
      COUNT(*) as cnt
    FROM "Job"
    WHERE source = 'MICRO1'
    GROUP BY DATE_TRUNC('minute', "updatedAt"), status
    ORDER BY minute_bucket DESC, status
    LIMIT 40
  `);
  console.log(JSON.stringify(r7.rows, null, 2));

  // 8. Show IMPORTED MICRO1 jobs
  console.log('\n=== 8. All IMPORTED MICRO1 jobs (updatedAt minute buckets) ===');
  const r8 = await client.query(`
    SELECT id, "externalId", title, "lastSeenAt", "updatedAt", "createdAt"
    FROM "Job"
    WHERE source = 'MICRO1' AND status = 'IMPORTED'
    ORDER BY "updatedAt" DESC
  `);
  for (const row of r8.rows) {
    console.log(JSON.stringify({
      id: row.id,
      externalId: row.externalId,
      title: row.title,
      lastSeenAt: toUTC(row.lastSeenAt),
      updatedAt: toUTC(row.updatedAt),
      createdAt: toUTC(row.createdAt),
    }));
  }

  await client.end();
  console.log('\nDisconnected');
}

main().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
