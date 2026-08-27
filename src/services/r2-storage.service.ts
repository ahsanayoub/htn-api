import { createHash, createHmac, randomUUID } from "node:crypto";
import path from "node:path";

const MAX_RESUME_SIZE = 10 * 1024 * 1024;
const DEFAULT_EXPIRES_IN = 15 * 60;
const MAX_EXPIRES_IN = 7 * 24 * 60 * 60;

const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export interface ResumeUploadRequest {
  fileName: string;
  mimeType: string;
  size: number;
}

export interface ResumeUploadUrl {
  uploadId: string;
  storageKey: string;
  uploadUrl: string;
  expiresIn: number;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface ResumeObjectMetadata {
  size: number;
  mimeType?: string;
  etag?: string;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(pathValue: string): string {
  return pathValue
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function formatAmzDate(date: Date): { shortDate: string; amzDate: string } {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return {
    shortDate: iso.slice(0, 8),
    amzDate: iso,
  };
}

function canonicalQuery(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "resume";
}

export class R2StorageService {
  private readonly accountId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly bucket: string;
  private readonly expiresIn: number;

  constructor() {
    this.accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
    this.bucket = process.env.R2_BUCKET_NAME?.trim() ?? "";

    const configuredExpiry = Number(process.env.R2_PRESIGNED_URL_EXPIRES_SECONDS);
    this.expiresIn = Number.isFinite(configuredExpiry) && configuredExpiry > 0
      ? Math.min(Math.floor(configuredExpiry), MAX_EXPIRES_IN)
      : DEFAULT_EXPIRES_IN;

    if (!this.accountId || !this.accessKeyId || !this.secretAccessKey || !this.bucket) {
      throw new Error(
        "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
      );
    }
  }

  createResumeUploadUrl(input: ResumeUploadRequest): ResumeUploadUrl {
    const fileName = sanitizeFileName(input.fileName);
    const mimeType = input.mimeType.trim().toLowerCase();
    const expectedExtension = MIME_TO_EXTENSION[mimeType];

    if (!expectedExtension) {
      throw new Error("Unsupported resume type. Only PDF, DOC, and DOCX files are accepted.");
    }

    if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_RESUME_SIZE) {
      throw new Error("Resume must be between 1 byte and 10 MB.");
    }

    const uploadId = randomUUID();
    const storageKey = `resumes/${uploadId}${expectedExtension}`;
    const uploadUrl = this.createPresignedUrl("PUT", storageKey, mimeType);

    return {
      uploadId,
      storageKey,
      uploadUrl,
      expiresIn: this.expiresIn,
      fileName,
      mimeType,
      size: input.size,
    };
  }

  async verifyUploadedResume(
    uploadId: string,
    storageKey: string,
    expectedMimeType: string,
    expectedSize: number,
  ): Promise<ResumeObjectMetadata> {
    if (!this.isValidResumeKey(uploadId, storageKey)) {
      throw new Error("Invalid resume storage key.");
    }

    const response = await fetch(this.createPresignedUrl("HEAD", storageKey));

    if (!response.ok) {
      throw new Error("Resume upload was not found in storage. Upload the resume before submitting the application.");
    }

    const size = Number(response.headers.get("content-length") ?? "0");
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const etag = response.headers.get("etag") ?? undefined;

    if (!Number.isFinite(size) || size <= 0 || size > MAX_RESUME_SIZE) {
      throw new Error("Stored resume has an invalid size.");
    }

    if (size !== expectedSize) {
      throw new Error("Resume size does not match the uploaded file.");
    }

    if (mimeType && mimeType !== expectedMimeType.toLowerCase()) {
      throw new Error("Resume content type does not match the uploaded file.");
    }

    return { size, mimeType, etag };
  }

  private isValidResumeKey(uploadId: string, storageKey: string): boolean {
    return new RegExp(`^resumes/${uploadId}\\.(pdf|doc|docx)$`, "i").test(storageKey);
  }

  private createPresignedUrl(
    method: "GET" | "HEAD" | "PUT" | "DELETE",
    storageKey: string,
    contentType?: string,
  ): string {
    const region = "auto";
    const service = "s3";
    const host = `${this.accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = `/${encodePath(this.bucket)}/${encodePath(storageKey)}`;
    const now = new Date();
    const { shortDate, amzDate } = formatAmzDate(now);
    const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;

    const headers: Record<string, string> = {
      host,
    };

    if (method === "PUT" && contentType) {
      headers["content-type"] = contentType;
    }

    const signedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaders
      .map((header) => `${header}:${headers[header].trim()}\n`)
      .join("");

    const query = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.accessKeyId}/${credentialScope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(this.expiresIn),
      "X-Amz-SignedHeaders": signedHeaders.join(";"),
      "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    };

    const canonicalQueryString = canonicalQuery(query);
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders.join(";"),
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n");

    const signature = createHmac("sha256", signingKey(this.secretAccessKey, shortDate, region, service))
      .update(stringToSign)
      .digest("hex");

    return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }
}

export { MAX_RESUME_SIZE, MIME_TO_EXTENSION };
