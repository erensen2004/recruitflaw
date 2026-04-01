import fs from "node:fs/promises";
import path from "node:path";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "..");
const DEFAULT_BASE_URL = process.env.RECRUITFLOW_CV_PARSE_BASE_URL || "http://127.0.0.1:8080";
const DEFAULT_VENDOR_EMAIL = process.env.SMOKE_VENDOR_EMAIL || "vendor@staffingpro.com";
const DEFAULT_VENDOR_PASSWORD = process.env.SMOKE_VENDOR_PASSWORD || "vendor123";
const DEFAULT_IMAGE_PATH =
  process.env.VISION_SMOKE_IMAGE_PATH ||
  path.resolve(WORKSPACE_ROOT, "attached_assets/Screenshot_2026-03-13_at_17.13.00_1773411182971.png");
const DEFAULT_PDF_PATH =
  process.env.VISION_SMOKE_PDF_PATH ||
  "/Users/erensen/Downloads/Mustafa Şamil İleri_CV.pdf";

function detectMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function login(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Vendor login failed: ${response.status}`);
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) throw new Error("Vendor login returned no token");
  return payload.token;
}

async function parseFile(baseUrl: string, token: string, filePath: string) {
  const buffer = await fs.readFile(filePath);
  const response = await fetch(`${baseUrl}/api/cv-parse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": detectMimeType(filePath),
      "X-File-Name": encodeURIComponent(path.basename(filePath)),
    },
    body: buffer,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path.basename(filePath)} parse failed: ${response.status} ${text}`);
  }

  return JSON.parse(text) as {
    parseStatus?: string | null;
    parseProvider?: string | null;
    extractionMethod?: string | null;
    extractionFallbackUsed?: boolean | null;
    extractionFailureClass?: string | null;
    sourceTextLength?: number | null;
    warnings?: string[] | null;
    executiveHeadline?: string | null;
    summary?: string | null;
  };
}

async function main() {
  const baseUrl = DEFAULT_BASE_URL.replace(/\/$/, "");
  const token = await login(baseUrl, DEFAULT_VENDOR_EMAIL, DEFAULT_VENDOR_PASSWORD);
  const imageResult = await parseFile(baseUrl, token, DEFAULT_IMAGE_PATH);
  const pdfResult = await parseFile(baseUrl, token, DEFAULT_PDF_PATH);

  console.log(
    JSON.stringify(
      {
        result: "ok",
        baseUrl,
        imageSmoke: {
          file: DEFAULT_IMAGE_PATH,
          parseStatus: imageResult.parseStatus ?? null,
          parseProvider: imageResult.parseProvider ?? null,
          extractionMethod: imageResult.extractionMethod ?? null,
          extractionFallbackUsed: Boolean(imageResult.extractionFallbackUsed),
          extractionFailureClass: imageResult.extractionFailureClass ?? null,
          sourceTextLength: imageResult.sourceTextLength ?? null,
          warnings: imageResult.warnings ?? [],
          executiveHeadline: imageResult.executiveHeadline ?? null,
        },
        problematicPdfSmoke: {
          file: DEFAULT_PDF_PATH,
          parseStatus: pdfResult.parseStatus ?? null,
          parseProvider: pdfResult.parseProvider ?? null,
          extractionMethod: pdfResult.extractionMethod ?? null,
          extractionFallbackUsed: Boolean(pdfResult.extractionFallbackUsed),
          extractionFailureClass: pdfResult.extractionFailureClass ?? null,
          sourceTextLength: pdfResult.sourceTextLength ?? null,
          warnings: pdfResult.warnings ?? [],
          executiveHeadline: pdfResult.executiveHeadline ?? null,
          summary: pdfResult.summary ?? null,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
