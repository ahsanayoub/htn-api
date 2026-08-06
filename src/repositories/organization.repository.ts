import prisma from "../prisma/client.js";
import { OrganizationType } from "@prisma/client";

export class OrganizationRepository {
  async findOrCreate(args: {
    name: string;
    type?: OrganizationType;
    externalId?: string | null;
    sourceVersion?: string | null;
    website?: string | null;
    linkedinUrl?: string | null;
    logoUrl?: string | null;
    industry?: string | null;
    description?: string | null;
    headquarters?: string | null;
    employeeCount?: number | null;
    foundedYear?: number | null;
    legalName?: string | null;
  }): Promise<string> {
    const existing = await prisma.organization.findFirst({
      where: { name: args.name },
    });

    if (existing) {
      return existing.id;
    }

    const created = await prisma.organization.create({
      data: {
        name: args.name,
        type: args.type ?? OrganizationType.COMPANY,
        externalId: args.externalId,
        sourceVersion: args.sourceVersion,
        website: args.website,
        linkedinUrl: args.linkedinUrl,
        logoUrl: args.logoUrl,
        industry: args.industry,
        description: args.description,
        headquarters: args.headquarters,
        employeeCount: args.employeeCount,
        foundedYear: args.foundedYear,
        legalName: args.legalName,
      },
    });

    return created.id;
  }

  async findById(id: string) {
    return prisma.organization.findUnique({
      where: { id },
      include: {
        jobs: true,
        contacts: true,
        candidates: true,
        documents: true,
      },
    });
  }

  async findByName(name: string) {
    return prisma.organization.findFirst({
      where: { name },
      include: {
        jobs: true,
        contacts: true,
        candidates: true,
        documents: true,
      },
    });
  }

  async findByExternalId(externalId: string) {
    return prisma.organization.findFirst({
      where: { externalId },
    });
  }
}
