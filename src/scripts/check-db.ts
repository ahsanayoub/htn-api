import "dotenv/config";
import prisma from "../prisma/client.js";

async function main() {
  const counts = {
    jobs: await prisma.job.count(),
    organizations: await prisma.organization.count(),
    skills: await prisma.skill.count(),
    applications: await prisma.application.count(),
    candidates: await prisma.candidate.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
