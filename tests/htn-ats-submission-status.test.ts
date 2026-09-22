import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApplicationStatus } from "@prisma/client";
import { AppError } from "../src/errors/app-error.js";
import { ApplicationService } from "../src/services/applications.service.js";

const APPLICATION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CANDIDATE_ID = "11111111-2222-3333-4444-555555555555";
const JOB_ID = "99999999-8888-7777-6666-555555555555";

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../src/prisma/client.js", () => ({
  default: {
    application: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    $transaction: vi.fn(),
  },
}));

const synchronizeHtnSubmission = vi.fn();
vi.mock("../src/services/htn-ats-sync.service.js", () => ({
  synchronizeHtnSubmission,
}));

function baseApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    candidateId: CANDIDATE_ID,
    jobId: JOB_ID,
    status: ApplicationStatus.APPLIED,
    source: "RECRUITER",
    coverLetter: null,
    additionalNotes: "keep-me",
    metadata: { recruiterId: "recruiter-1" },
    candidate: {
      id: CANDIDATE_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      documents: [],
    },
    job: {
      id: JOB_ID,
      externalId: "ats-job-1",
      title: "Engineer",
      status: "ACTIVE",
      organization: { id: "org-1", externalId: "ats-org", name: "Headsbase" },
    },
    ...overrides,
  };
}

function captureError(promise: Promise<unknown>): Promise<AppError> {
  return promise.catch((e: unknown) => e) as Promise<AppError>;
}

describe("ApplicationService.updateApplicationStatus (ATS inbound reuse)", () => {
  const service = new ApplicationService();

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    synchronizeHtnSubmission.mockReset();
  });

  it("updates APPLIED → INTERVIEW and does not call HTN→ATS sync", async () => {
    const existing = baseApplication({ status: ApplicationStatus.APPLIED });
    const updated = baseApplication({ status: ApplicationStatus.INTERVIEW });
    mockFindUnique.mockResolvedValue(existing);
    mockUpdate.mockResolvedValue(updated);

    const result = await service.updateApplicationStatus(APPLICATION_ID, "INTERVIEW");

    expect(result.status).toBe(ApplicationStatus.INTERVIEW);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: APPLICATION_ID },
      data: { status: ApplicationStatus.INTERVIEW },
      include: expect.any(Object),
    });
    expect(synchronizeHtnSubmission).not.toHaveBeenCalled();
    expect(result.candidateId).toBe(CANDIDATE_ID);
    expect(result.jobId).toBe(JOB_ID);
    expect(result.source).toBe("RECRUITER");
    expect(result.additionalNotes).toBe("keep-me");
  });

  it("updates to OFFER", async () => {
    mockFindUnique.mockResolvedValue(baseApplication({ status: ApplicationStatus.SCREENING }));
    mockUpdate.mockResolvedValue(baseApplication({ status: ApplicationStatus.OFFER }));
    const result = await service.updateApplicationStatus(APPLICATION_ID, "OFFER");
    expect(result.status).toBe(ApplicationStatus.OFFER);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("rejects invalid status without writing", async () => {
    const error = await captureError(service.updateApplicationStatus(APPLICATION_ID, "INTERVIEW_COMPLETED"));
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.statusCode).toBe(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when application is missing", async () => {
    mockFindUnique.mockResolvedValue(null);
    const error = await captureError(service.updateApplicationStatus(APPLICATION_ID, "APPLIED"));
    expect(error.code).toBe("APPLICATION_NOT_FOUND");
    expect(error.statusCode).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent when status is unchanged", async () => {
    const existing = baseApplication({ status: ApplicationStatus.APPLIED });
    mockFindUnique.mockResolvedValue(existing);
    const result = await service.updateApplicationStatus(APPLICATION_ID, "APPLIED");
    expect(result.status).toBe(ApplicationStatus.APPLIED);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(synchronizeHtnSubmission).not.toHaveBeenCalled();
  });
});

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

describe("PUT /integrations/ats/submissions/:htnSubmissionId", () => {
  const ORIGINAL_KEY = process.env.HTN_ATS_INTEGRATION_KEY;

  beforeEach(() => {
    process.env.HTN_ATS_INTEGRATION_KEY = "test-integration-key";
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    synchronizeHtnSubmission.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.HTN_ATS_INTEGRATION_KEY;
    else process.env.HTN_ATS_INTEGRATION_KEY = ORIGINAL_KEY;
  });

  async function loadHandler() {
    const mod = await import("../src/routes/integrations-ats.js");
    return findPutHandler(mod.default as unknown as { stack?: RouteLayer[] }, "/submissions/:htnSubmissionId");
  }

  it("registers the submissions status route on the ATS integration router", async () => {
    const mod = await import("../src/routes/integrations-ats.js");
    const routes = ((mod.default as unknown as { stack?: RouteLayer[] }).stack ?? [])
      .filter((layer) => layer.route?.path)
      .map((layer) => ({
        path: layer.route!.path!,
        methods: Object.keys(layer.route!.methods ?? {}).filter((m) => m !== "_all"),
      }));
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/submissions/:htnSubmissionId",
          methods: expect.arrayContaining(["put"]),
        }),
      ]),
    );
  });

  it("rejects missing integration key with 401", async () => {
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      { params: { htnSubmissionId: APPLICATION_ID }, headers: {}, body: { status: "INTERVIEW" } },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect((res.body as { code: string }).code).toBe("UNAUTHORIZED");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("rejects invalid integration key with 401", async () => {
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        params: { htnSubmissionId: APPLICATION_ID },
        headers: { authorization: "Bearer wrong-key" },
        body: { status: "INTERVIEW" },
      },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid status with 400 and does not update", async () => {
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        params: { htnSubmissionId: APPLICATION_ID },
        headers: { authorization: "Bearer test-integration-key" },
        body: { status: "NOT_A_STATUS" },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 for nonexistent htnSubmissionId", async () => {
    mockFindUnique.mockResolvedValue(null);
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        params: { htnSubmissionId: APPLICATION_ID },
        headers: { authorization: "Bearer test-integration-key" },
        body: { status: "SCREENING" },
      },
      res,
    );
    expect(res.statusCode).toBe(404);
    expect((res.body as { code: string }).code).toBe("APPLICATION_NOT_FOUND");
  });

  it("accepts authenticated APPLIED update and optional ATS metadata", async () => {
    mockFindUnique.mockResolvedValue(baseApplication({ status: ApplicationStatus.SCREENING }));
    mockUpdate.mockResolvedValue(baseApplication({ status: ApplicationStatus.APPLIED }));
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        params: { htnSubmissionId: APPLICATION_ID },
        headers: { authorization: "Bearer test-integration-key" },
        body: {
          status: "APPLIED",
          atsApplicationId: "ats-app-1",
          atsStage: "NOT_APPLIED",
          changedAt: "2026-09-22T12:00:00.000Z",
        },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      success: boolean;
      data: {
        id: string;
        status: string;
        candidateId: string;
        jobId: string;
        source: string;
        atsApplicationId: string;
        atsStage: string;
        changedAt: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(APPLICATION_ID);
    expect(body.data.status).toBe("APPLIED");
    expect(body.data.candidateId).toBe(CANDIDATE_ID);
    expect(body.data.jobId).toBe(JOB_ID);
    expect(body.data.source).toBe("RECRUITER");
    expect(body.data.atsApplicationId).toBe("ats-app-1");
    expect(body.data.atsStage).toBe("NOT_APPLIED");
    expect(body.data.changedAt).toBe("2026-09-22T12:00:00.000Z");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ApplicationStatus.APPLIED },
      }),
    );
    expect(synchronizeHtnSubmission).not.toHaveBeenCalled();
  });

  it("accepts authenticated INTERVIEW update", async () => {
    mockFindUnique.mockResolvedValue(baseApplication({ status: ApplicationStatus.APPLIED }));
    mockUpdate.mockResolvedValue(baseApplication({ status: ApplicationStatus.INTERVIEW }));
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        params: { htnSubmissionId: APPLICATION_ID },
        headers: { authorization: "Bearer test-integration-key" },
        body: { status: "INTERVIEW", atsApplicationId: "ats-app-2", atsStage: "INTERVIEW_COMPLETED" },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { status: string } }).data.status).toBe("INTERVIEW");
    expect(synchronizeHtnSubmission).not.toHaveBeenCalled();
  });

  it("keeps identity fields unchanged on repeated same-status update", async () => {
    const existing = baseApplication({ status: ApplicationStatus.REJECTED });
    mockFindUnique.mockResolvedValue(existing);
    const handler = await loadHandler();
    const res = mockRes();
    await handler(
      {
        params: { htnSubmissionId: APPLICATION_ID },
        headers: { authorization: "Bearer test-integration-key" },
        body: {
          status: "REJECTED",
          atsApplicationId: "ats-app-3",
          atsStage: "REJECTED",
          changedAt: "2026-09-22T13:00:00.000Z",
        },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data.candidateId).toBe(CANDIDATE_ID);
    expect(data.jobId).toBe(JOB_ID);
    expect(data.source).toBe("RECRUITER");
    expect(synchronizeHtnSubmission).not.toHaveBeenCalled();
  });

  it("does not import outbound HTN→ATS submission sync into the ATS integration route", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/routes/integrations-ats.ts"),
      "utf8",
    );
    expect(source).toContain('put("/submissions/:htnSubmissionId"');
    expect(source).not.toContain("synchronizeHtnSubmission");
    expect(source).not.toContain("htn-ats-sync.service");
  });

  it("remains mounted under /integrations/ats in app.ts", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/app.ts"),
      "utf8",
    );
    expect(appSource).toContain('app.use("/integrations/ats", atsIntegrationRouter)');
  });
});
