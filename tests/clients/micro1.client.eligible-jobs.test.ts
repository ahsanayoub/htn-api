import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SECRET_TOKEN = "super-secret-referral-token-do-not-log";

const { mockGet, mockPost, mockCreate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockCreate = vi.fn(() => ({ get: mockGet, post: mockPost }));
  return { mockGet, mockPost, mockCreate };
});

vi.mock("axios", () => {
  const isAxiosError = (error: unknown): boolean =>
    Boolean(error && typeof error === "object" && (error as { isAxiosError?: boolean }).isAxiosError);

  return {
    default: {
      create: mockCreate,
      get: vi.fn(),
      isAxiosError,
    },
    isAxiosError,
  };
});

import { Micro1Client } from "../../src/clients/micro1.client.js";

function axiosError(status?: number, extras: Record<string, unknown> = {}) {
  return {
    isAxiosError: true,
    response: status !== undefined ? { status, data: { message: "fail" } } : undefined,
    config: {
      headers: {
        Authorization: `Bearer ${SECRET_TOKEN}`,
      },
    },
    message: status ? `Request failed with status code ${status}` : "Network Error",
    ...extras,
  };
}

function eligibleEnvelope(overrides: {
  total?: number;
  data?: Array<Record<string, unknown>>;
  status?: boolean;
  statusCode?: number;
  message?: string;
} = {}) {
  return {
    status: overrides.status ?? true,
    statusCode: overrides.statusCode ?? 200,
    message: overrides.message ?? "ok",
    total: overrides.total ?? 1,
    data: overrides.data ?? [
      {
        job_id: "job-1",
        job_name: "Engineer",
        company_name: "Acme",
        apply_url:
          "https://jobs.micro1.ai/post/job-1?referralCode=abc&utm_source=referral",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MICRO1_REFERRAL_ACCESS_TOKEN = SECRET_TOKEN;
});

afterEach(() => {
  delete process.env.MICRO1_REFERRAL_ACCESS_TOKEN;
});

describe("Micro1Client.getEligibleJobs", () => {
  it("GETs /referral/portal/eligible-jobs with Authorization Bearer and limit<=100", async () => {
    mockGet.mockResolvedValueOnce({ data: eligibleEnvelope({ total: 1 }) });

    const client = new Micro1Client();
    const result = await client.getEligibleJobs(2, 150);

    expect(mockGet).toHaveBeenCalledTimes(1);
    const [path, config] = mockGet.mock.calls[0];
    expect(path).toBe("/referral/portal/eligible-jobs");
    expect(config.params).toEqual({ page: 2, limit: 100 });
    expect(config.headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  it("prefers page limit of 100 for full crawl requests", async () => {
    mockGet.mockResolvedValueOnce({ data: eligibleEnvelope() });

    const client = new Micro1Client();
    await client.getEligibleJobs(1);

    expect(mockGet.mock.calls[0][1].params.limit).toBe(100);
  });

  it("sends Authorization header and never logs the token", async () => {
    mockGet.mockResolvedValueOnce({ data: eligibleEnvelope() });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new Micro1Client();
    await client.getEligibleJobs(1);

    expect(mockGet.mock.calls[0][1].headers.Authorization).toContain("Bearer ");
    const allLogText = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(allLogText).not.toContain(SECRET_TOKEN);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fails clearly on missing token without treating it as an empty feed", async () => {
    delete process.env.MICRO1_REFERRAL_ACCESS_TOKEN;
    const client = new Micro1Client();

    await expect(client.getEligibleJobs(1)).rejects.toThrow(
      /Micro1 referral authentication failed/,
    );
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("maps 401 to authentication failure without exposing the token", async () => {
    mockGet.mockRejectedValueOnce(axiosError(401));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new Micro1Client();
    await expect(client.getEligibleJobs(1)).rejects.toThrow(
      "Micro1 referral authentication failed",
    );

    const dumped = errorSpy.mock.calls
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(dumped).not.toContain(SECRET_TOKEN);
    errorSpy.mockRestore();
  });

  it("maps 500 to a safe API error", async () => {
    mockGet.mockRejectedValueOnce(axiosError(500));
    const client = new Micro1Client();
    await expect(client.getEligibleJobs(1)).rejects.toThrow(
      "Micro1 referral API error: 500",
    );
  });

  it("rejects malformed envelopes", async () => {
    mockGet.mockResolvedValueOnce({ data: { status: true } });
    const client = new Micro1Client();
    await expect(client.getEligibleJobs(1)).rejects.toThrow(
      /missing data array|malformed envelope/,
    );
  });

  it("rejects invalid total", async () => {
    mockGet.mockResolvedValueOnce({
      data: { status: true, data: [], total: "nope" },
    });
    const client = new Micro1Client();
    await expect(client.getEligibleJobs(1)).rejects.toThrow(/invalid total/);
  });

  it("keeps legacy getJobs (public get_all_jobs) available", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        status: true,
        statusCode: 200,
        message: "ok",
        total: 1,
        data: [
          {
            job_id: "pub-1",
            job_name: "Public Job",
            company_name: "Co",
            apply_url: "https://jobs.micro1.ai/post/pub-1",
          },
        ],
        page: 1,
        limit: 18,
        total_pages: 1,
      },
    });

    const client = new Micro1Client();
    const result = await client.getJobs(1, 18);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe("/job/portal");
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      action: "get_all_jobs",
      filters: { type: ["EXPERT"] },
    });
    expect(result.data[0].job_id).toBe("pub-1");
  });
});
