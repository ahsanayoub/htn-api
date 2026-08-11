// Reproduce the error by simulating missing DATABASE_URL (Railway scenario)
// This intentionally does NOT load .env, simulating Railway where .env is not deployed
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL || "";
console.log("DATABASE_URL is:", process.env.DATABASE_URL ? "[SET]" : "[MISSING/EMPTY]");
console.log("connectionString:", JSON.stringify(connectionString));

try {
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log("Attempting prisma.job.findMany()...");
  const jobs = await prisma.job.findMany({ take: 1 });
  console.log("SUCCESS - jobs count:", jobs.length);
  await prisma.$disconnect();
} catch (error) {
  console.error("========== FULL PRISMA EXCEPTION ==========");
  console.error(error);
  console.error("========== ERROR MESSAGE ==========");
  if (error instanceof Error) {
    console.error(error.message);
    console.error("========== STACK TRACE ==========");
    console.error(error.stack);
  }
  process.exit(1);
}