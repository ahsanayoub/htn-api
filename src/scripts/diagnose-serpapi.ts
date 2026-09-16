import "dotenv/config";

import axios from "axios";

const apiKey = process.env.SERPAPI_API_KEY?.trim();
if (!apiKey) {
  console.error("SERPAPI_API_KEY is not configured");
  process.exit(1);
}

const query =
  process.argv.slice(2).join(" ").trim() ||
  'site:linkedin.com/in/ ("PEB Designer" OR "Structural Designer") ("Tekla" OR "MBS") India';

async function main() {
  const response = await axios.get<unknown>("https://serpapi.com/search", {
    timeout: Number(process.env.SERPAPI_TIMEOUT_MS) || 30000,
    params: {
      engine: "google",
      q: query,
      num: 10,
      hl: "en",
      api_key: apiKey,
    },
  });

  const data =
    typeof response.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown>)
      : null;

  const organic = data?.organic_results;
  const first =
    Array.isArray(organic) &&
    organic.length > 0 &&
    typeof organic[0] === "object" &&
    organic[0] !== null
      ? (organic[0] as Record<string, unknown>)
      : null;

  console.log(
    JSON.stringify(
      {
        httpStatus: response.status,
        topLevelKeys: data ? Object.keys(data) : [],
        hasOrganicResults: Array.isArray(organic),
        organicResultsLength: Array.isArray(organic) ? organic.length : null,
        hasError: typeof data?.error === "string" && data.error.trim().length > 0,
        firstResultKeys: first ? Object.keys(first) : [],
        firstResult: first
          ? {
              title: typeof first.title === "string" ? first.title : null,
              link: typeof first.link === "string" ? first.link : null,
              redirect_link:
                typeof first.redirect_link === "string"
                  ? first.redirect_link
                  : null,
              displayed_link:
                typeof first.displayed_link === "string"
                  ? first.displayed_link
                  : null,
              source: typeof first.source === "string" ? first.source : null,
              snippet: typeof first.snippet === "string" ? first.snippet : null,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const status =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: unknown } }).response?.status === "number"
      ? (error as { response: { status: number } }).response.status
      : null;

  console.error(
    JSON.stringify(
      {
        failed: true,
        httpStatus: status,
        message: "SerpAPI diagnostic request failed",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
