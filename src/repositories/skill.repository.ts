import prisma from "../prisma/client.js";

export class SkillRepository {
  async findOrCreate(name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Skill name cannot be empty");
    }

    const existing = await prisma.skill.findFirst({
      where: {
        name: {
          equals: trimmed,
          mode: "insensitive",
        },
      },
    });

    if (existing) {
      return { id: existing.id, name: existing.name };
    }

    const created = await prisma.skill.create({
      data: { name: trimmed },
    });

    return { id: created.id, name: created.name };
  }

  async findOrCreateMany(names: string[]): Promise<{ id: string; name: string }[]> {
    const results: { id: string; name: string }[] = [];

    for (const name of names) {
      const skill = await this.findOrCreate(name);
      results.push(skill);
    }

    return results;
  }

  async findByName(name: string) {
    return prisma.skill.findFirst({
      where: {
        name: {
          equals: name,
          mode: "insensitive",
        },
      },
      include: {
        candidateSkills: {
          include: {
            candidate: true,
          },
        },
        jobSkills: {
          include: {
            job: true,
          },
        },
        categoryAssignments: {
          include: {
            category: true,
          },
        },
      },
    });
  }

  async findAll() {
    return prisma.skill.findMany({
      orderBy: { name: "asc" },
    });
  }
}
