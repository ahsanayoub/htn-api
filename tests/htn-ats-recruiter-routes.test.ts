import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import recruiterIntegrationRouter from "../src/routes/integrations-ats-recruiters.js";

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
};

function routeEntries(router: { stack?: RouteLayer[] }): Array<{ path: string; methods: string[] }> {
  return (router.stack ?? [])
    .filter((layer) => layer.route?.path)
    .map((layer) => ({
      path: layer.route!.path!,
      methods: Object.keys(layer.route!.methods ?? {}).filter((method) => method !== "_all"),
    }));
}

describe("ATS recruiter-management routes remain intact", () => {
  it("keeps list, assign, remove, detail, and summary endpoints", () => {
    const routes = routeEntries(recruiterIntegrationRouter as unknown as { stack?: RouteLayer[] });
    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/jobs/:atsJobId/recruiters", methods: expect.arrayContaining(["get"]) }),
      expect.objectContaining({ path: "/jobs/:atsJobId/recruiters/:recruiterId", methods: expect.arrayContaining(["post"]) }),
      expect.objectContaining({ path: "/jobs/:atsJobId/recruiters/:recruiterId", methods: expect.arrayContaining(["delete"]) }),
      expect.objectContaining({ path: "/recruiters", methods: expect.arrayContaining(["get"]) }),
      expect.objectContaining({ path: "/recruiters/:recruiterId", methods: expect.arrayContaining(["get"]) }),
      expect.objectContaining({ path: "/jobs/recruiter-summary", methods: expect.arrayContaining(["get"]) }),
    ]));
  });

  it("still mounts recruiter-management routes on /integrations/ats", () => {
    const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/app.ts"), "utf8");
    expect(appSource).toContain('import atsRecruiterIntegrationRouter from "./routes/integrations-ats-recruiters.js"');
    expect(appSource).toContain('app.use("/integrations/ats", atsIntegrationRouter)');
    expect(appSource).toContain('app.use("/integrations/ats", atsRecruiterIntegrationRouter)');
  });
});
