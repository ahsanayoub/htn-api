import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockQueryRaw, mockExecuteRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock("../src/prisma/client.js", () => ({
  default: {
    $queryRawUnsafe: mockQueryRaw,
    $executeRawUnsafe: mockExecuteRaw,
    application: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/services/applications.service.js", () => ({
  ApplicationService: class {
    updateApplicationStatus = vi.fn();
  },
}));

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle: (req: unknown, res: unknown) => Promise<unknown> }>;
  };
};

function findPutHandler(router: { stack?: RouteLayer[] }, path: string) {
  const layer = (router.stack ?? []).find(
    (entry) => entry.route?.path === path && entry.route.methods?.put,
  );
  const handle = layer?.route?.stack?.[0]?.handle;
  if (!handle) throw new Error(`PUT ${path} handler not found`);
  return handle;
}

function mockRes() {
  const res: {
    statusCode?: number;
    body?: unknown;
    status: (code: number) => unknown;
    json: (payload: unknown) => unknown;
  } = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const ATS_JOB_ID = "cmatsjob00000000000000001";
const ORG_EXT = "cmatsorg00000000000000001";

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "ATS Synced Role",
    organization: { id: ORG_EXT, name: "Headsbase ATS Org" },
    status: "OPEN",
    applyUrl: "https://jobs.micro1.ai/post/example?referralCode=abc",
    metadata: {
      integration: "HTN_ATS",
      atsJobId: ATS_JOB_ID,
      atsOrganizationId: ORG_EXT,
      atsClientId: "cmclient00000000000000001",
      atsRequirements: { skills: ["TypeScript"] },
    },
    ...overrides,
  };
}

describe("PUT /integrations/ats/jobs/:atsJobId", () => {
  const ORIGINAL_KEY = process.env.HTN_ATS_INTEGRATION_KEY;

  beforeEach(() => {
    process.env.HTN_ATS_INTEGRATION_KEY = "test-integration-key";
    mockQueryRaw.mockReset();
    mockExecuteRaw.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.HTN_ATS_INTEGRATION_KEY;
    else process.env.HTN_ATS_INTEGRATION_KEY = ORIGINAL_KEY;
  });

  async function loadHandler() {
    const mod = await import("../src/routes/integrations-ats.js");
    return findPutHandler(mod.default as unknown as { stack?: RouteLayer[] }, "/jobs/:atsJobId");
  }

  function authHeaders() {
    return { authorization: "Bearer test-integration-key" };
  }

  it("creates OTHER + INTERNAL with origin=ats metadata when no collision", async () => {
    const handler = await loadHandler();
    const res = mockRes();

    // org lookup (miss) → OTHER lookup (miss) → MANUAL lookup (miss) → final select
    mockQueryRaw
      .mockResolvedValueOnce([]) // org
      .mockResolvedValueOnce([]) // OTHER
      .mockResolvedValueOnce([]) // MANUAL
      .mockResolvedValueOnce([
        {
          id: "new-job-id",
          externalId: ATS_JOB_ID,
          source: "OTHER",
          visibility: "INTERNAL",
          title: "ATS Synced Role",
          status: "ACTIVE",
          organizationId: "org-id",
          organizationName: "Headsbase ATS Org",
          lastSyncedAt: new Date(),
          lastSeenAt: new Date(),
        },
      ]);
    mockExecuteRaw.mockResolvedValue(1);

    await handler(
      { params: { atsJobId: ATS_JOB_ID }, headers: authHeaders(), body: baseBody() },
      res,
    );

    expect(res.statusCode).toBeUndefined(); // json() without status → 200 path
    expect((res.body as { success: boolean }).success).toBe(true);

    const insertCall = mockExecuteRaw.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO "Job"'),
    );
    expect(insertCall).toBeTruthy();
    expect(String(insertCall![0])).toContain("'OTHER'");
    expect(String(insertCall![0])).toContain("'INTERNAL'");
    expect(String(insertCall![0])).toContain('"lastSeenAt"');

    const metadataArg = insertCall!.find((arg) => typeof arg === "string" && arg.includes('"origin"'));
    expect(metadataArg).toBeTruthy();
    const parsed = JSON.parse(String(metadataArg));
    expect(parsed.origin).toBe("ats");
    expect(parsed.integration).toBe("HTN_ATS");
    expect(parsed.atsJobId).toBe(ATS_JOB_ID);
    expect(parsed.atsOrganizationId).toBe(ORG_EXT);
    expect(parsed.atsClientId).toBe("cmclient00000000000000001");
    expect(parsed.syncedAt).toBeTruthy();
  });

  it("updates an existing OTHER record and does not insert", async () => {
    const handler = await loadHandler();
    const res = mockRes();
    const existingId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    mockQueryRaw
      .mockResolvedValueOnce([{ id: "org-id" }]) // org
      .mockResolvedValueOnce([{ id: existingId, source: "OTHER" }]) // OTHER hit
      .mockResolvedValueOnce([
        {
          id: existingId,
          externalId: ATS_JOB_ID,
          source: "OTHER",
          visibility: "INTERNAL",
          title: "ATS Synced Role",
          status: "ACTIVE",
          organizationId: "org-id",
          organizationName: "Headsbase ATS Org",
        },
      ]);
    mockExecuteRaw.mockResolvedValue(1);

    await handler(
      { params: { atsJobId: ATS_JOB_ID }, headers: authHeaders(), body: baseBody() },
      res,
    );

    expect((res.body as { success: boolean }).success).toBe(true);
    const insertCall = mockExecuteRaw.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO "Job"'),
    );
    expect(insertCall).toBeUndefined();
    const updateCall = mockExecuteRaw.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE "Job"'),
    );
    expect(updateCall).toBeTruthy();
    expect(String(updateCall![0])).toContain("visibility='INTERNAL'");
    expect(String(updateCall![0])).toContain('"lastSeenAt"=NOW()');
    expect(updateCall).toEqual(expect.arrayContaining([existingId]));
  });

  it("does NOT create OTHER when MANUAL already owns the externalId", async () => {
    const handler = await loadHandler();
    const res = mockRes();

    mockQueryRaw
      .mockResolvedValueOnce([{ id: "org-id" }]) // org
      .mockResolvedValueOnce([]) // OTHER miss
      .mockResolvedValueOnce([{ id: "manual-job-id", source: "MANUAL" }]); // MANUAL hit
    mockExecuteRaw.mockResolvedValue(1);

    await handler(
      { params: { atsJobId: ATS_JOB_ID }, headers: authHeaders(), body: baseBody() },
      res,
    );

    expect(res.statusCode).toBe(409);
    expect((res.body as { code: string }).code).toBe("ATS_JOB_SOURCE_COLLISION");
    const jobWrite = mockExecuteRaw.mock.calls.find((call) => {
      const sql = String(call[0]);
      return sql.includes('INSERT INTO "Job"') || (sql.includes('UPDATE "Job"') && sql.includes("visibility"));
    });
    expect(jobWrite).toBeUndefined();
  });

  it("rejects unauthorized callers", async () => {
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      { params: { atsJobId: ATS_JOB_ID }, headers: {}, body: baseBody() },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
