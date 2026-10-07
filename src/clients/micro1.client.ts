import axios, { AxiosInstance, isAxiosError } from "axios";

import type { Micro1PortalResponseDTO } from "../dto/micro1-portal-response.dto.js";
import {
  clampMicro1EligibleJobsLimit,
  getMicro1ReferralAccessToken,
  MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT,
} from "../config/micro1.config.js";

export class Micro1Client {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: "https://prod-api.micro1.ai/api/v1",
            timeout: 30000,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
                "Origin": "https://jobs.micro1.ai",
                "Referer": "https://jobs.micro1.ai/",
            },
        });
    }

    /**
     * Legacy public discovery: POST /job/portal action=get_all_jobs (EXPERT).
     * Kept as fallback when MICRO1_DISCOVERY_SOURCE=public|existing.
     */
    async getJobs(
        page: number = 1,
        limit: number = 18
    ): Promise<Micro1PortalResponseDTO> {
        try {
            const { data } = await this.client.post(
                "/job/portal",
                {
                    action: "get_all_jobs",
                    filters: {
                        type: ["EXPERT"],
                    },
                },
                {
                    params: {
                        page,
                        limit,
                        keyword: "",
                    },
                }
            );

            console.log({
                total: data.total,
                page: data.page,
                limit: data.limit,
                totalPages: data.total_pages,
              });

              console.log("Returned jobs:", data.data.length);
    
            return data;
        } catch (error: any) {
            console.error("Micro1 API Error:");
            console.error(error.response?.data);
    
            throw error;
        }
    }

    /**
     * Authenticated Referral Dashboard discovery:
     * GET /referral/portal/eligible-jobs
     *
     * Requires MICRO1_REFERRAL_ACCESS_TOKEN (or an explicit accessToken argument).
     * Never logs the bearer token or Authorization header.
     */
    async getEligibleJobs(
        page: number = 1,
        limit: number = MICRO1_ELIGIBLE_JOBS_PAGE_LIMIT,
        accessToken?: string,
    ): Promise<Micro1PortalResponseDTO> {
        const token = accessToken?.trim() || getMicro1ReferralAccessToken();
        if (!token) {
            throw new Error(
                "Micro1 referral authentication failed: MICRO1_REFERRAL_ACCESS_TOKEN is not configured",
            );
        }

        const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
        const safeLimit = clampMicro1EligibleJobsLimit(limit);

        try {
            const { data } = await this.client.get("/referral/portal/eligible-jobs", {
                params: {
                    page: safePage,
                    limit: safeLimit,
                },
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            return this.validateEligibleJobsEnvelope(data);
        } catch (error: unknown) {
            throw this.mapEligibleJobsError(error);
        }
    }

    async fetch(url: string): Promise<string> {
        const { data } = await axios.get<string>(url);

        return data;
    }

    private validateEligibleJobsEnvelope(data: unknown): Micro1PortalResponseDTO {
        if (data === null || typeof data !== "object") {
            throw new Error("Micro1 eligible-jobs returned a malformed envelope");
        }

        const envelope = data as Record<string, unknown>;

        if (!Array.isArray(envelope.data)) {
            throw new Error("Micro1 eligible-jobs response missing data array");
        }

        const total = envelope.total;
        if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
            throw new Error("Micro1 eligible-jobs response has invalid total");
        }

        return {
            status: Boolean(envelope.status),
            message: typeof envelope.message === "string" ? envelope.message : "",
            statusCode:
                typeof envelope.statusCode === "number" ? envelope.statusCode : 200,
            total,
            data: envelope.data as Micro1PortalResponseDTO["data"],
        };
    }

    private mapEligibleJobsError(error: unknown): Error {
        if (isAxiosError(error)) {
            const status = error.response?.status;

            if (status === 401 || status === 403) {
                return new Error("Micro1 referral authentication failed");
            }
            if (status === 429) {
                return new Error("Micro1 referral rate limited");
            }
            if (status !== undefined && status >= 500) {
                return new Error(`Micro1 referral API error: ${status}`);
            }
            if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
                return new Error("Micro1 referral request timed out");
            }
            if (!error.response) {
                return new Error("Micro1 referral network error");
            }

            return new Error(
                `Micro1 referral API error: ${status ?? "unknown"}`,
            );
        }

        if (error instanceof Error) {
            // Preserve our own validation / auth-config errors as-is.
            return error;
        }

        return new Error("Micro1 referral request failed");
    }
}
