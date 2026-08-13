import "dotenv/config";
import prisma from "../src/prisma/client.js";

async function main() {
  // Count total jobs
  const totalJobs = await prisma.job.count();
  console.log("Total jobs in database:", totalJobs);

  // Count jobs by source
  const jobsBySource = await prisma.job.groupBy({
    by: ["source"],
    where: { source: { not: null } },
    _count: true,
  });
  console.log("Jobs by source:", JSON.stringify(jobsBySource, null, 2));

  // Count organizations
  const totalOrgs = await prisma.organization.count();
  console.log("Total organizations:", totalOrgs);

  // Count skills
  const totalSkills = await prisma.skill.count();
  console.log("Total skills:", totalSkills);

  // Count JobSkill relationships
  const totalJobSkills = await prisma.jobSkill.count();
  console.log("Total JobSkill relationships:", totalJobSkills);

  // Sample a job with skills and organization
  const sampleJob = await prisma.job.findFirst({
    where: { source: "MICRO1" },
    include: {
      organization: true,
      jobSkills: { include: { skill: true } },
    },
  });
  console.log("\nSample job:", JSON.stringify(sampleJob, null, 2));

  // Check for duplicate jobs (same externalId + source)
  const duplicates = await prisma.$queryRaw`
    SELECT "source", "externalId", COUNT(*) as count
    FROM "Job"
    GROUP BY "source", "externalId"
    HAVING COUNT(*) > 1
    LIMIT 10
  `;
  console.log("\nDuplicate jobs (same externalId + source):", JSON.stringify(duplicates, null, 2));

  // Check jobs with all fields populated
  const jobsWithSalary = await prisma.job.count({
    where: { salaryMin: { not: null } },
  });
  console.log("\nJobs with salary data:", jobsWithSalary);

  const jobsWithLocation = await prisma.job.count({
    where: { location: { not: null } },
  });
  console.log("Jobs with location data:", jobsWithLocation);

  const jobsWithMetadata = await prisma.job.count({
    where: { metadata: { not: null } },
  });
  console.log("Jobs with metadata:", jobsWithMetadata);

  // Count jobs with skills
  const jobsWithSkills = await prisma.job.count({
    where: { jobSkills: { some: {} } },
  });
  console.log("Jobs with skills:", jobsWithSkills);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
