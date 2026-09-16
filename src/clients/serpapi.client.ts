import axios, { AxiosInstance, AxiosResponse } from "axios";
import { SearchProvider } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import type {
  NormalizedSearchResult,
  SearchProviderContract,
} from "../types/discovery.js";

interface SerpApiResponse {
  organic_results?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isGoogleRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "google.com" || url.hostname.endsWith(".google.com")) &&
      url.pathname === "/url"
    );
  } catch {
    return false;
  }
}

export class SerpApiClient implements SearchProviderContract {
  readonly name = SearchProvider.SERPAPI;
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly resultsPerPage: number;
  private readonly timeout: number;

  constructor() {
    this.apiKey = process.env.SERPAPI_API_KEY?.trim() ?? "";
    if (!this.apiKey) {
      throw new AppError("SERPAPI_API_KEY_MISSING", "SerpAPI API key is not configured", 503);
    }

    const configuredResults = Number(process.env.SERPAPI_RESULTS_PER_PAGE);
    this.resultsPerPage = Number.isFinite(configuredResults)
      ? Math.min(Math.max(Math.floor(configuredResults), 1), 10)
      : 10;

    const configuredTimeout = Number(process.env.SERPAPI_TIMEOUT_MS);
    this.timeout = Number.isFinite(configuredTimeout)
      ? Math.max(Math.floor(configuredTimeout), 1000)
      : 15000;

    this.client = axios.create({
      baseURL: "https://serpapi.com",
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "htn-api/1.0 (Talent Discovery)",
      },
    });
  }

  async execute(query: string): Promise<NormalizedSearchResult[]> {
    let response: AxiosResponse<SerpApiResponse>;

    try {
      response = await this.client.get("/search", {
        params: {
          engine: "google",
          q: query,
          num: this.resultsPerPage,
          hl: "en",
          api_key: this.apiKey,
        },
      });
    } catch (error: unknown) {
      throw this.buildRequestError(error);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new AppError("SERPAPI_HTTP_ERROR", `SerpAPI returned status ${response.status}`, 502);
    }

    return this.parseResults(response.data);
  }

  private async parseResults(data: unknown): Promise<NormalizedSearchResult[]> {
    if (!isRecord(data)) {
      throw new AppError("SERPAPI_INVALID_RESPONSE", "Invalid response from SerpAPI", 502);
    }

    const error = extractString(data, "error");
    if (error) {
      throw new AppError("SERPAPI_ERROR_RESPONSE", `SerpAPI error: ${error}`, 502);
    }

    const results = data.organic_results;
    if (!Array.isArray(results)) {
      if (results == null) return [];
      throw new AppError("SERPAPI_INVALID_RESPONSE", "Invalid response from SerpAPI", 502);
    }

    const mapped: NormalizedSearchResult[] = [];

    for (const item of results) {
      if (!isRecord(item)) continue;

      const url = await this.resolveResultUrl(item);
      if (!url) continue;

      mapped.push({
        title: extractString(item, "title"),
        url,
        snippet: extractString(item, "snippet"),
        provider: SearchProvider.SERPAPI,
      });
    }

    return mapped;
  }

  private async resolveResultUrl(result: Record<string, unknown>): Promise<string | null> {
    const candidates = [
      extractString(result, "redirect_link"),
      extractString(result, "link"),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;

      // SerpAPI can return Google's relative /goto?... redirect instead of
      // the destination URL. Resolve it against Google before following it.
      const resolvedCandidate = candidate.startsWith("/")
        ? new URL(candidate, "https://www.google.com").toString()
        : candidate;

      if (!isValidHttpUrl(resolvedCandidate)) continue;
      if (!isGoogleRedirect(resolvedCandidate) && !resolvedCandidate.includes("/goto?")) {
        return resolvedCandidate;
      }

      try {
        const response = await axios.get(resolvedCandidate, {
          timeout: this.timeout,
          maxRedirects: 5,
          validateStatus: () => true,
          responseType: "stream",
        });

        const request = response.request as {
          res?: { responseUrl?: unknown };
        };
        const finalUrl = request.res?.responseUrl;

        if (
          typeof finalUrl === "string" &&
          isValidHttpUrl(finalUrl) &&
          !isGoogleRedirect(finalUrl) &&
          !finalUrl.includes("/goto?")
        ) {
          return finalUrl;
        }
      } catch {
        // Skip an individual result when its Google redirect cannot be resolved.
      }
    }

    return null;
  }

  private buildRequestError(error: unknown): AppError {
    const err = error as { code?: string; response?: { status: number } };

    if (err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT") {
      return new AppError("SERPAPI_TIMEOUT", "SerpAPI request timed out", 504);
    }

    if (!err?.response) {
      return new AppError("SERPAPI_NETWORK_ERROR", "Failed to communicate with SerpAPI", 502);
    }

    return new AppError(
      "SERPAPI_HTTP_ERROR",
      `SerpAPI returned status ${err.response.status}`,
      502,
    );
  }
}
