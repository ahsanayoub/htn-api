import { DiscoverySearchStatus, DiscoveredProfileStatus, ProfileSource } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import prisma from "../prisma/client.js";
import { generateXRayQuery } from "./x-ray-query-generator.service.js";
import { DiscoveryService } from "./discovery.service.js";
import { SerpApiClient } from "../clients/serpapi.client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CriteriaInput = {
  roles?: unknown; skills?: unknown; locations?: unknown; companies?: unknown; sources?: unknown;
};

function requireUuid(value: string, message: string): void {
  if (!UUID_RE.test(value)) throw new AppError("VALIDATION_ERROR", message, 400);
}

function strings(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !v.trim())) {
    throw new AppError("VALIDATION_ERROR", `${field} must be an array of non-empty strings`, 400);
  }
  return value.map(v => (v as string).trim());
}

function sources(value: unknown): ProfileSource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !(v in ProfileSource))) {
    throw new AppError("VALIDATION_ERROR", "sources contains an invalid value", 400);
  }
  return value as ProfileSource[];
}

function criteria(input: CriteriaInput) {
  return {
    roles: strings(input.roles, "roles"),
    skills: strings(input.skills, "skills"),
    locations: strings(input.locations, "locations"),
    companies: strings(input.companies, "companies"),
    sources: sources(input.sources),
  };
}

function pageValue(value: unknown, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

export class DiscoverySearchService {
  async create(orgId: string, input: unknown) {
    requireUuid(orgId, "Invalid organization ID");
    if (!input || typeof input !== "object") throw new AppError("VALIDATION_ERROR", "Request body is required", 400);
    const body = input as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim()) throw new AppError("VALIDATION_ERROR", "name is required", 400);
    const c = criteria(body);
    const query = generateXRayQuery(c);
    if (!query) throw new AppError("VALIDATION_ERROR", "At least one searchable criterion is required", 400);
    const status = body.status === undefined ? DiscoverySearchStatus.DRAFT : body.status;
    if (typeof status !== "string" || !(status in DiscoverySearchStatus)) throw new AppError("VALIDATION_ERROR", "Invalid status", 400);
    return prisma.discoverySearch.create({ data: { organizationId: orgId, name: body.name.trim(), query, roles: c.roles ?? undefined, skills: c.skills ?? undefined, locations: c.locations ?? undefined, companies: c.companies ?? undefined, status: status as DiscoverySearchStatus } });
  }

  async list(orgId: string, options: { page?: unknown; limit?: unknown; status?: unknown }) {
    requireUuid(orgId, "Invalid organization ID");
    const page = pageValue(options.page, 1, 100000);
    const limit = pageValue(options.limit, 20, 100);
    let status: DiscoverySearchStatus | undefined;
    if (options.status !== undefined) {
      if (typeof options.status !== "string" || !(options.status in DiscoverySearchStatus)) throw new AppError("VALIDATION_ERROR", "Invalid status", 400);
      status = options.status as DiscoverySearchStatus;
    }
    const where = { organizationId: orgId, ...(status ? { status } : {}) };
    const [items, total] = await prisma.$transaction([prisma.discoverySearch.findMany({ where, skip: (page-1)*limit, take: limit, orderBy: { createdAt: "desc" } }), prisma.discoverySearch.count({ where })]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total } };
  }

  async get(orgId: string, id: string) {
    requireUuid(orgId, "Invalid organization ID"); requireUuid(id, "Invalid search ID");
    const item = await prisma.discoverySearch.findFirst({ where: { id, organizationId: orgId } });
    if (!item) throw new AppError("DISCOVERY_SEARCH_NOT_FOUND", "Discovery search not found", 404);
    return item;
  }

  async update(orgId: string, id: string, input: unknown) {
    await this.get(orgId, id);
    if (!input || typeof input !== "object") throw new AppError("VALIDATION_ERROR", "Request body is required", 400);
    const body = input as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) { if (typeof body.name !== "string" || !body.name.trim()) throw new AppError("VALIDATION_ERROR", "name must be a non-empty string", 400); data.name = body.name.trim(); }
    if (body.status !== undefined) { if (typeof body.status !== "string" || !(body.status in DiscoverySearchStatus)) throw new AppError("VALIDATION_ERROR", "Invalid status", 400); data.status = body.status; }
    const criteriaChanged = ["roles","skills","locations","companies","sources"].some(k => k in body);
    if (criteriaChanged) {
      const c = criteria(body); const query = generateXRayQuery(c);
      if (!query) throw new AppError("VALIDATION_ERROR", "At least one searchable criterion is required", 400);
      Object.assign(data, { query, roles: c.roles ?? undefined, skills: c.skills ?? undefined, locations: c.locations ?? undefined, companies: c.companies ?? undefined });
    }
    if (!Object.keys(data).length) throw new AppError("VALIDATION_ERROR", "No valid fields supplied", 400);
    return prisma.discoverySearch.update({ where: { id }, data });
  }

  async execute(orgId: string, id: string) {
    await this.get(orgId, id);
    return new DiscoveryService(new SerpApiClient()).executeSearch(id);
  }

  async runs(orgId: string, searchId: string) {
    await this.get(orgId, searchId);
    return prisma.discoverySearchRun.findMany({ where: { searchId }, orderBy: { createdAt: "desc" } });
  }

  async profiles(orgId: string, runId: string) {
    requireUuid(runId, "Invalid run ID");
    const run = await prisma.discoverySearchRun.findFirst({ where: { id: runId, search: { organizationId: orgId } } });
    if (!run) throw new AppError("DISCOVERY_SEARCH_NOT_FOUND", "Discovery run not found", 404);
    return prisma.discoveredProfile.findMany({ where: { searchRunId: runId }, orderBy: { discoveredAt: "desc" } });
  }

  async profile(orgId: string, profileId: string) {
    requireUuid(profileId, "Invalid profile ID");
    const item = await prisma.discoveredProfile.findFirst({ where: { id: profileId, searchRun: { search: { organizationId: orgId } } } });
    if (!item) throw new AppError("DISCOVERY_SEARCH_NOT_FOUND", "Discovered profile not found", 404);
    return item;
  }

  async updateProfile(orgId: string, profileId: string, input: unknown) {
    await this.profile(orgId, profileId);
    if (!input || typeof input !== "object") throw new AppError("VALIDATION_ERROR", "Request body is required", 400);
    const body = input as Record<string, unknown>; const data: Record<string, unknown> = {};
    if (body.name !== undefined) { if (typeof body.name !== "string" || !body.name.trim()) throw new AppError("VALIDATION_ERROR", "name must be a non-empty string", 400); data.name = body.name.trim(); }
    if (body.status !== undefined) { if (typeof body.status !== "string" || !(body.status in DiscoveredProfileStatus)) throw new AppError("VALIDATION_ERROR", "Invalid profile status", 400); data.status = body.status; if (body.status !== DiscoveredProfileStatus.NEW) data.reviewedAt = new Date(); }
    if (!Object.keys(data).length) throw new AppError("VALIDATION_ERROR", "No valid fields supplied", 400);
    return prisma.discoveredProfile.update({ where: { id: profileId }, data });
  }
}
