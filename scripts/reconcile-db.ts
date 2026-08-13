import "dotenv/config";
import prisma from "../src/prisma/client.js";

async function main() {
    // 1. Count jobs grouped by source
    const bySource = await prisma.job.groupBy({
        by: ["source"],
        _count: { _all: true },
        orderBy: { source: "asc" },
    });
    console.log("\n=== Jobs by Source ===");
    for (const row of bySource) {
        console.log(`  ${row.source}: ${row._count._all}`);
    }

    // 2. Count jobs grouped by status
    const byStatus = await prisma.job.groupBy({
        by: ["status"],
        _count: { _all: true },
        orderBy: { status: "asc" },
    });
    console.log("\n=== Jobs by Status ===");
    for (const row of byStatus) {
        console.log(`  ${row.status}: ${row._count._all}`);
    }

    // 3. Count jobs grouped by source AND status
    const bySourceStatus = await prisma.job.groupBy({
        by: ["source", "status"],
        _count: { _all: true },
        orderBy: [{ source: "asc" }, { status: "asc" }],
    });
    console.log("\n=== Jobs by Source & Status ===");
    for (const row of bySourceStatus) {
        console.log(`  ${row.source} | ${row.status}: ${row._count._all}`);
    }

    // 4. Count jobs with externalId NULL
    const nullExternal = await prisma.job.count({
        where: { externalId: null },
    });
    console.log(`\n=== Jobs with NULL externalId: ${nullExternal} ===`);

    // 5. Count duplicate externalIds (same externalId appearing more than once)
    const duplicateExternalIds = await prisma.$queryRaw<
        Array<{ external_id: string; count: number }>
    >`
        SELECT "externalId" as external_id, COUNT(*) as count
        FROM "Job"
        WHERE "externalId" IS NOT NULL
        GROUP BY "externalId"
        HAVING COUNT(*) > 1
        ORDER BY count DESC
    `;
    console.log(`\n=== Duplicate externalIds: ${duplicateExternalIds.length} ===`);
    for (const dup of duplicateExternalIds.slice(0, 10)) {
        console.log(`  ${dup.external_id}: ${dup.count} occurrences`);
    }

    // 6. Earliest and latest createdAt / postedAt
    const earliest = await prisma.job.findFirst({
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, postedAt: true, externalId: true, title: true, source: true },
    });
    const latest = await prisma.job.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, postedAt: true, externalId: true, title: true, source: true },
    });
    console.log("\n=== Date Range ===");
    console.log(`  Earliest createdAt: ${earliest?.createdAt ?? "N/A"} (postedAt: ${earliest?.postedAt ?? "N/A"})`);
    console.log(`    - ${earliest?.source} / ${earliest?.title?.substring(0, 50)} / extId: ${earliest?.externalId}`);
    console.log(`  Latest createdAt: ${latest?.createdAt ?? "N/A"} (postedAt: ${latest?.postedAt ?? "N/A"})`);
    console.log(`    - ${latest?.source} / ${latest?.title?.substring(0, 50)} / extId: ${latest?.externalId}`);

    // 7. How many jobs were created from the current Micro1 import (createdAt after the import run)
    // The import ran on 2026-08-10. Let's count MICRO1 jobs by recent createdAt
    const micro1Total = await prisma.job.count({
        where: { source: "MICRO1" },
    });
    const micro1Recent = await prisma.job.count({
        where: {
            source: "MICRO1",
            createdAt: { gte: new Date("2026-08-06T00:00:00.000Z") },
        },
    });
    const micro1Today = await prisma.job.count({
        where: {
            source: "MICRO1",
            createdAt: { gte: new Date("2026-08-10T00:00:00.000Z") },
        },
    });
    console.log("\n=== Micro1 Import Stats ===");
    console.log(`  Total MICRO1 jobs: ${micro1Total}`);
    console.log(`  MICRO1 jobs created since Aug 6: ${micro1Recent}`);
    console.log(`  MICRO1 jobs created since Aug 10 (today): ${micro1Today}`);

    // 8. Jobs whose source is MICRO1 - status breakdown
    const micro1ByStatus = await prisma.$queryRaw<
        Array<{ status: string; count: number }>
    >`
        SELECT "status" as status, COUNT(*) as count
        FROM "Job"
        WHERE "source" = 'MICRO1'
        GROUP BY "status"
        ORDER BY "status"
    `;
    console.log("\n=== MICRO1 Jobs by Status ===");
    for (const row of micro1ByStatus) {
        console.log(`  ${row.status}: ${row.count}`);
    }

    // Summary table
    console.log("\n=== Reconciliation Report ===");
    console.log("Source     | Total | Active | Closed");
    console.log("-----------|-------|--------|-------");
    const summary = await prisma.$queryRaw<
        Array<{
            source: string;
            total: number;
            active: number;
            closed: number;
        }>
    >`
        SELECT 
            "source" as source,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE "status" = 'ACTIVE') as active,
            COUNT(*) FILTER (WHERE "status" IN ('CLOSED', 'ARCHIVED', 'ON_HOLD')) as closed
        FROM "Job"
        GROUP BY "source"
        ORDER BY "source"
    `;
    for (const row of summary) {
        console.log(`  ${row.source.padEnd(10)} | ${String(row.total).padStart(5)} | ${String(row.active).padStart(6)} | ${String(row.closed).padStart(6)}`);
    }

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error("Error:", err);
    await prisma.$disconnect();
    process.exit(1);
});
