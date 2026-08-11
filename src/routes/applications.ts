import { Router } from "express";
import { createApplication } from "../services/candidates.service.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const required = ["jobId", "firstName", "lastName", "email", "location"];
    const missing = required.filter(
      (field) => typeof body[field] !== "string" || !body[field].trim(),
    );

    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    if (body.certificationAcknowledged !== true) {
      return res.status(400).json({
        success: false,
        message: "Certification acknowledgement is required",
      });
    }

    const application = await createApplication({
      jobId: body.jobId.trim(),
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      linkedinUrl: typeof body.linkedinUrl === "string" ? body.linkedinUrl : undefined,
      location: body.location,
      currentCompany: typeof body.currentCompany === "string" ? body.currentCompany : undefined,
      currentTitle: typeof body.currentTitle === "string" ? body.currentTitle : undefined,
      yearsExperience: typeof body.yearsExperience === "number" ? body.yearsExperience : undefined,
      desiredSalary: typeof body.desiredSalary === "number" ? body.desiredSalary : undefined,
      noticePeriod: typeof body.noticePeriod === "number" ? body.noticePeriod : undefined,
      coverLetter: typeof body.coverLetter === "string" ? body.coverLetter : undefined,
      additionalNotes: typeof body.additionalNotes === "string" ? body.additionalNotes : undefined,
      certificationAcknowledged: body.certificationAcknowledged,
    });

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      data: {
        id: application.id,
        jobId: application.jobId,
        jobTitle: application.job.title,
        status: application.status,
        submittedAt: application.submittedAt,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "JOB_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    if (error instanceof Error && error.message === "ALREADY_APPLIED") {
      return res.status(409).json({
        success: false,
        message: "You have already applied to this role",
      });
    }

    console.error("Application submission failed", error);
    return res.status(500).json({ success: false, message: "Unable to submit application" });
  }
});

export default router;
