import "dotenv/config";
import prisma from "../prisma/client.js";

async function main() {
    const count = await prisma.job.count();
    console.log("Total jobs in PostgreSQL:", count);
    const recent = await prisma.job.findMany({
        where: { source: "MICRO1" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { externalId: true, title: true, source: true, applyUrl: true },
    });
    console.log("Recent Micro1 jobs:", JSON.stringify(recent, null, 2));
    await prisma.$disconnect();
}

main().catch(console.error);
