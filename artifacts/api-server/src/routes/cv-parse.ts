import { Router, Request, Response } from "express";
import OpenAI from "openai";
import mammoth from "mammoth";
import { PdfReader } from "pdfreader";
import { createWorker } from "tesseract.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAuth } from "google-auth-library";
import {
  createCanvas as createNodeCanvas,
  DOMMatrix as NodeDOMMatrix,
  ImageData as NodeImageData,
  Path2D as NodePath2D,
} from "@napi-rs/canvas";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { CvParseBodySchema, CvParseResponseSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();
const MAX_VERCEL_FILE_BYTES = Number(process.env.MAX_CV_PARSE_BYTES || "4000000");
const MODEL_INPUT_CHAR_LIMIT = Number(process.env.MAX_CV_MODEL_INPUT_CHARS || "22000");
const ENRICHMENT_SOURCE_CHAR_LIMIT = Number(process.env.MAX_CV_ENRICHMENT_CHARS || "14000");
const DIRECT_DOCUMENT_TIMEOUT_MS = Number(process.env.CV_DIRECT_DOCUMENT_TIMEOUT_MS || "18000");
const MODEL_TIMEOUT_MS = Number(process.env.CV_MODEL_TIMEOUT_MS || "12000");
const ENRICHMENT_TIMEOUT_MS = Number(process.env.CV_ENRICHMENT_TIMEOUT_MS || "9000");
const MAX_PARSE_SOURCE_TEXT_CHARS = Number(process.env.MAX_CV_PARSE_SOURCE_TEXT_CHARS || "24000");
const DOCX_EXTRACTION_TIMEOUT_MS = Number(process.env.CV_DOCX_EXTRACTION_TIMEOUT_MS || "12000");
const PDF_EXTRACTION_TIMEOUT_MS = Number(process.env.CV_PDF_EXTRACTION_TIMEOUT_MS || "12000");
const OCR_TIMEOUT_MS = Number(process.env.CV_OCR_TIMEOUT_MS || "15000");
const OCR_PAGE_LIMIT = Number(process.env.CV_OCR_PAGE_LIMIT || "1");
const OCR_MIN_TEXT_CHARS = Number(process.env.CV_OCR_MIN_TEXT_CHARS || "80");
const OCR_RENDER_SCALE = Number(process.env.CV_OCR_RENDER_SCALE || "1.5");
const MAX_PROVIDER_MODEL_ATTEMPTS = Number(process.env.CV_MAX_PROVIDER_MODEL_ATTEMPTS || "2");
const OCR_LANGUAGES = (process.env.CV_OCR_LANGUAGES || "eng,tur")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const GOOGLE_VISION_API_KEY =
  process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_CLOUD_VISION_API_KEY || null;
const GOOGLE_VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";
const DEFAULT_VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "global";
const DEFAULT_VERTEX_MODEL =
  process.env.VERTEX_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || null;
const GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || null;
const VERTEX_INCLUDE_SOURCE_TEXT =
  process.env.CV_VERTEX_ENRICHMENT_INCLUDE_SOURCE_TEXT === "1" ||
  process.env.CV_VERTEX_ENRICHMENT_INCLUDE_SOURCE_TEXT === "true";

const DEFAULT_OPENROUTER_MODELS = [
  "liquid/lfm-2.5-1.2b-instruct:free",
  "arcee-ai/trinity-large-preview:free",
  "google/gemma-3-27b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
];

const NULLISH_STRINGS = new Set([
  "null",
  "undefined",
  "n/a",
  "na",
  "none",
  "not found",
  "unknown",
  "-",
  "—",
]);

const SECTION_HEADINGS = {
  skills: ["skills", "technical skills", "core skills", "competencies", "yetkinlikler", "beceriler"],
  experience: ["experience", "work experience", "professional experience", "employment", "work history", "deneyim"],
  education: ["education", "academic background", "qualifications", "egitim", "öğrenim"],
  languages: ["languages", "language", "diller", "dil"],
  summary: ["summary", "profile", "objective", "professional summary", "about", "özet", "profil"],
} as const;

const ALL_SECTION_HEADINGS = Object.values(SECTION_HEADINGS).flat() as string[];

type ParsedExperienceItem = {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  highlights: string[] | null;
  scope: string | null;
  techStack: string[] | null;
  impactHighlights: string[] | null;
  current: boolean | null;
  seniorityContribution: string | null;
};

type ParsedEducationItem = {
  institution: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  confidence: number | null;
};

type ParsedLanguageItem = {
  name: string | null;
  level: string | null;
  confidence: number | null;
  source: string | null;
};

type ParsedFieldConfidence = {
  contact: number | null;
  experience: number | null;
  education: number | null;
  languages: number | null;
  compensation: number | null;
  summary: number | null;
};

type ExtractionFailureClass = "runtime" | "timeout" | "empty_text" | "oversized" | "ocr_required" | null;

type ExtractionDebug = {
  extractionMethod: string | null;
  extractionFallbackUsed: boolean;
  extractionFailureClass: ExtractionFailureClass;
  sourceTextLength: number | null;
  sourceTextTruncated: boolean;
};

type ParsedCandidate = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  skills: string | null;
  expectedSalary: number | null;
  currentTitle: string | null;
  location: string | null;
  yearsExperience: number | null;
  education: string | null;
  languages: string | null;
  summary: string | null;
  standardizedProfile: string | null;
  executiveHeadline: string | null;
  professionalSnapshot: string | null;
  domainFocus: string[];
  senioritySignal: string | null;
  candidateStrengths: string[];
  candidateRisks: string[];
  notableAchievements: string[];
  inferredWorkModel: string | null;
  locationFlexibility: string | null;
  salarySignal: string | null;
  languageItems: ParsedLanguageItem[];
  fieldConfidence: ParsedFieldConfidence | null;
  evidence: string[];
  parsedSkills: string[];
  parsedExperience: ParsedExperienceItem[];
  parsedEducation: ParsedEducationItem[];
  parseConfidence: number | null;
  parseReviewRequired: boolean;
  parseStatus: "not_started" | "processing" | "parsed" | "partial" | "failed";
  parseProvider: string | null;
  warnings: string[];
  extractionMethod: string | null;
  extractionFallbackUsed: boolean;
  extractionFailureClass: ExtractionFailureClass;
  sourceTextLength: number | null;
  sourceTextTruncated: boolean;
};

type DocumentKind = "pdf" | "docx" | "image" | "text" | "json" | "unsupported";
type TextExtractionResult = {
  text: string;
  method: "pdf-parse" | "pdfreader" | "mammoth" | "ocr";
  warnings: string[];
};

async function ensurePdfRuntimePolyfills() {
  const runtimeGlobal = globalThis as typeof globalThis & {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };

  if (runtimeGlobal.DOMMatrix && runtimeGlobal.ImageData && runtimeGlobal.Path2D) {
    return;
  }

  runtimeGlobal.DOMMatrix ??= NodeDOMMatrix;
  runtimeGlobal.ImageData ??= NodeImageData;
  runtimeGlobal.Path2D ??= NodePath2D;
}

async function loadPdfParse() {
  await ensurePdfRuntimePolyfills();
  const module = await import("pdf-parse");
  if (typeof module.PDFParse !== "function") {
    throw new Error("pdf-parse PDFParse export is not available");
  }
  return module.PDFParse;
}

async function loadPdfJs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

const TITLE_HINT_REGEX =
  /\b(engineer|developer|manager|specialist|analyst|consultant|designer|coordinator|technician|tester|qa|automation|architect|lead|head|director|intern|associate|operator|officer)\b/i;
const COMPANY_HINT_REGEX =
  /\b(a\.?s\.?|ltd|limited|inc|corp|company|technology|technologies|teknoloji|yazılım|yazilim|software|systems|solutions|robotics|bank|holding|university|üniversitesi|university|group)\b/i;
const DEGREE_HINT_REGEX =
  /\b(bachelor|master|degree|diploma|associate|lisans|yüksek lisans|önlisans|ön lisans|m.s.|b.s.|mba|phd|doctorate)\b/i;
const INSTITUTION_HINT_REGEX = /\b(university|üniversite|faculty|fakülte|institute|school|college|academy|lise)\b/i;
const DATE_RANGE_REGEX =
  /(?:(?:0?[1-9]|1[0-2])\s*[./-]\s*)?(?:19|20)\d{2}\s*[-–]\s*(?:present|current|now|devam|halen|ongoing|(?:(?:0?[1-9]|1[0-2])\s*[./-]\s*)?(?:19|20)\d{2})/i;

function getConfiguredModels(): string[] {
  const configured =
    process.env.OPENROUTER_MODEL ||
    process.env.OPENAI_CV_PARSE_MODEL ||
    process.env.CV_PARSE_MODEL;

  if (!configured) return DEFAULT_OPENROUTER_MODELS;

  return configured
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function getActiveProviderModels(models: string[]): string[] {
  return models.slice(0, Math.max(1, MAX_PROVIDER_MODEL_ATTEMPTS));
}

function isRetryableProviderError(message: string): boolean {
  return /rate|429|timeout|connection|network|temporarily unavailable/i.test(message);
}

function getAiClientConfig():
  | {
      client: OpenAI;
      models: string[];
      provider: "openrouter" | "openai" | "replit";
    }
  | null {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        defaultHeaders: {
          ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
          ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {}),
        },
      }),
      models: getConfiguredModels(),
      provider: "openrouter",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
      }),
      models: getConfiguredModels(),
      provider: "openai",
    };
  }

  if (process.env.REPLIT_AI_TOKEN) {
    return {
      client: new OpenAI({
        apiKey: process.env.REPLIT_AI_TOKEN,
        baseURL: "https://ai.replit.com",
      }),
      models: getConfiguredModels(),
      provider: "replit",
    };
  }

  return null;
}

type GeminiClient =
  | {
      kind: "apiKey";
      genAI: GoogleGenerativeAI;
      model: string;
    }
  | {
      kind: "vertex";
      auth: GoogleAuth;
      model: string;
      projectId: string | null;
      location: string;
    };

type GoogleServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
};

function parseGoogleServiceAccountCredentials(): GoogleServiceAccountCredentials | null {
  const raw = GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
    ? Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
    : GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as GoogleServiceAccountCredentials;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Missing client_email or private_key");
    }
    return {
      ...parsed,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Google service account credentials could not be parsed: ${message}`);
  }
}

function getGeminiClient(): GeminiClient | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) {
    return {
      kind: "apiKey",
      genAI: new GoogleGenerativeAI(apiKey),
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    };
  }

  const useVertex =
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "1" ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ||
    process.env.GOOGLE_GENAI_USE_VERTEX === "1" ||
    process.env.GOOGLE_GENAI_USE_VERTEX === "true" ||
    process.env.VERTEX_AI_USE_ADC === "1" ||
    process.env.VERTEX_AI_USE_ADC === "true" ||
    Boolean(process.env.VERTEX_AI_PROJECT) ||
    Boolean(process.env.GOOGLE_CLOUD_PROJECT) ||
    Boolean(process.env.GCLOUD_PROJECT) ||
    Boolean(process.env.GOOGLE_PROJECT_ID);

  if (!useVertex) return null;

  const credentials = parseGoogleServiceAccountCredentials();

  return {
    kind: "vertex",
    auth: new GoogleAuth({
      credentials: credentials || undefined,
      projectId:
        process.env.VERTEX_AI_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_PROJECT_ID ||
        credentials?.project_id ||
        undefined,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }),
    model: DEFAULT_VERTEX_MODEL,
    projectId:
      process.env.VERTEX_AI_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_PROJECT_ID ||
      credentials?.project_id ||
      null,
    location: DEFAULT_VERTEX_LOCATION,
  };
}

function isGeminiDirectParseEnabled(): boolean {
  return !(
    process.env.CV_DISABLE_DIRECT_GEMINI_PARSE === "1" ||
    process.env.CV_DISABLE_DIRECT_GEMINI_PARSE === "true"
  );
}

async function getVertexAccessToken(auth: GoogleAuth): Promise<string> {
  const client = await auth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result?.token;
  if (!token) {
    throw new Error("Vertex AI access token could not be resolved from Application Default Credentials.");
  }
  return token;
}

async function resolveVertexProjectId(client: Extract<GeminiClient, { kind: "vertex" }>): Promise<string> {
  if (client.projectId) return client.projectId;
  const projectId = await client.auth.getProjectId();
  if (!projectId) {
    throw new Error("Vertex AI project could not be resolved. Set VERTEX_AI_PROJECT or configure ADC project.");
  }
  return projectId;
}

function extractGeminiResponseText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }

  const inlineText = payload?.text;
  if (typeof inlineText === "string" && inlineText.trim()) {
    return inlineText.trim();
  }

  throw new Error("Gemini returned no readable text content.");
}

async function generateGeminiContent(
  gemini: GeminiClient,
  params: {
    contents: Array<Record<string, unknown>>;
    generationConfig?: Record<string, unknown>;
  },
): Promise<string> {
  if (gemini.kind === "apiKey") {
    const model = gemini.genAI.getGenerativeModel({ model: gemini.model });
    const result = await model.generateContent({
      contents: params.contents as any,
      generationConfig: params.generationConfig as any,
    } as any);
    return result.response.text();
  }

  const projectId = await resolveVertexProjectId(gemini);
  const accessToken = await getVertexAccessToken(gemini.auth);
  const modelPath = `projects/${projectId}/locations/${gemini.location}/publishers/google/models/${gemini.model}`;
  const response = await fetch(`https://aiplatform.googleapis.com/v1/${modelPath}:generateContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: params.contents,
      generationConfig: params.generationConfig,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vertex AI request failed (${response.status}): ${body.slice(0, 400)}`);
  }

  return extractGeminiResponseText(await response.json());
}

function decodeHeaderFileName(rawHeader: string | string[] | undefined): string | null {
  if (!rawHeader) return null;
  const raw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function detectDocumentKind(contentType: string | undefined, fileName: string | null): DocumentKind {
  const normalizedType = (contentType || "").toLowerCase();
  const normalizedName = (fileName || "").toLowerCase();

  if (normalizedType.includes("application/json")) return "json";
  if (normalizedType.includes("text/plain")) return "text";
  if (normalizedType.includes("application/pdf") || normalizedName.endsWith(".pdf")) return "pdf";
  if (
    normalizedType.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    normalizedName.endsWith(".docx")
  ) {
    return "docx";
  }
  if (normalizedType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(normalizedName)) return "image";
  return "unsupported";
}

function buildUniversalPrompt(): string {
  return [
    "You are parsing CVs and resumes into a recruiter-safe JSON structure.",
    "Return exactly one JSON object and nothing else.",
    "Never invent missing fields. Use null, empty arrays, or low confidence if the source is weak.",
    "If a document looks scanned, noisy, or incomplete, still return the best partial result.",
    "skills should be the strongest hard skills only.",
    "standardizedProfile should be a compact normalized recruiter summary in this order:",
    "Headline | Contact | Location | Experience | Skills | Education | Languages.",
    "parseConfidence must be an integer from 0 to 100.",
    "parseReviewRequired must be true when the document quality is weak or important fields are missing.",
    "parseStatus must be 'parsed', 'partial', or 'failed'.",
    "Required JSON keys:",
    [
      "firstName",
      "lastName",
      "email",
      "phone",
      "skills",
      "expectedSalary",
      "currentTitle",
      "location",
      "yearsExperience",
      "education",
      "languages",
      "summary",
      "standardizedProfile",
      "parsedSkills",
      "parsedExperience",
      "parsedEducation",
      "parseConfidence",
      "parseReviewRequired",
      "parseStatus",
      "warnings",
    ].join(", "),
  ].join(" ");
}

function createEmptyParse(provider: string | null, warning: string): ParsedCandidate {
  return {
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    skills: null,
    expectedSalary: null,
    currentTitle: null,
    location: null,
    yearsExperience: null,
    education: null,
    languages: null,
    summary: null,
    standardizedProfile: null,
    executiveHeadline: null,
    professionalSnapshot: null,
    domainFocus: [],
    senioritySignal: null,
    candidateStrengths: [],
    candidateRisks: [],
    notableAchievements: [],
    inferredWorkModel: null,
    locationFlexibility: null,
    salarySignal: null,
    languageItems: [],
    fieldConfidence: null,
    evidence: [],
    parsedSkills: [],
    parsedExperience: [],
    parsedEducation: [],
    parseConfidence: 0,
    parseReviewRequired: true,
    parseStatus: "failed",
    parseProvider: provider,
    warnings: [warning],
    extractionMethod: null,
    extractionFallbackUsed: false,
    extractionFailureClass: null,
    sourceTextLength: null,
    sourceTextTruncated: false,
  };
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("AI returned invalid JSON");
  }
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (NULLISH_STRINGS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function clampString(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}

function clampStringList(values: string[], maxItems: number, maxLength: number): string[] {
  return dedupeList(values.map((value) => clampString(value, maxLength)).filter((value): value is string => Boolean(value))).slice(0, maxItems);
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function normalizePhone(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const hasPlus = normalized.includes("+");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : digits;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return clampStringList(
      value
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item)),
      100,
      500,
    );
  }

  const asString = normalizeString(value);
  if (!asString) return [];
  return clampStringList(
    asString
      .split(/,|\n|•|·|\|/)
      .map((item) => item.trim())
      .filter(Boolean),
    100,
    500,
  );
}

function normalizeExperience(value: unknown): ParsedExperienceItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      company: clampString(normalizeString(record.company), 200),
      title: clampString(normalizeString(record.title), 200),
      startDate: clampString(normalizeString(record.startDate), 50),
      endDate: clampString(normalizeString(record.endDate), 50),
      highlights: clampStringList(normalizeStringList(record.highlights), 20, 500),
      scope: clampString(normalizeString(record.scope), 1000),
      techStack: clampStringList(normalizeStringList(record.techStack), 20, 200),
      impactHighlights: clampStringList(normalizeStringList(record.impactHighlights), 20, 500),
      current: typeof record.current === "boolean" ? record.current : null,
      seniorityContribution: clampString(normalizeString(record.seniorityContribution), 200),
    };
  }).filter((item) => item.company || item.title || item.startDate || item.endDate || item.highlights?.length || item.scope || item.techStack?.length || item.impactHighlights?.length);
}

function normalizeEducation(value: unknown): ParsedEducationItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      institution: clampString(normalizeString(record.institution), 300),
      degree: clampString(normalizeString(record.degree), 300),
      fieldOfStudy: clampString(normalizeString(record.fieldOfStudy), 300),
      startDate: clampString(normalizeString(record.startDate), 50),
      endDate: clampString(normalizeString(record.endDate), 50),
      confidence: normalizeConfidencePercent(record.confidence),
    };
  }).filter((item) => item.institution || item.degree || item.fieldOfStudy || item.startDate || item.endDate || item.confidence != null);
}

function normalizeLanguageItems(value: unknown): ParsedLanguageItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
      return {
        name: clampString(normalizeString(record.name), 100),
        level: clampString(normalizeString(record.level), 100),
        confidence: normalizeConfidencePercent(record.confidence),
        source: clampString(normalizeString(record.source), 100),
      };
    })
    .filter((item) => item.name || item.level || item.confidence != null || item.source);
}

function normalizeFieldConfidence(value: unknown): ParsedFieldConfidence | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const normalized: ParsedFieldConfidence = {
    contact: normalizeConfidencePercent(record.contact),
    experience: normalizeConfidencePercent(record.experience),
    education: normalizeConfidencePercent(record.education),
    languages: normalizeConfidencePercent(record.languages),
    compensation: normalizeConfidencePercent(record.compensation),
    summary: normalizeConfidencePercent(record.summary),
  };

  return Object.values(normalized).some((item) => item != null) ? normalized : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeConfidencePercent(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function classifyExtractionError(error: unknown): ExtractionFailureClass {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!message) return "runtime";
  if (message.includes("timed out") || message.includes("aborted")) return "timeout";
  if (
    message.includes("dommatrix") ||
    message.includes("pdfjs") ||
    message.includes("worker") ||
    message.includes("module") ||
    message.includes("runtime")
  ) {
    return "runtime";
  }
  if (message.includes("no readable text") || message.includes("contains no readable text") || message.includes("converted into text")) {
    return "empty_text";
  }
  if (message.includes("payload exceeds") || message.includes("too large")) return "oversized";
  if (message.includes("ocr")) return "ocr_required";
  return "runtime";
}

function normalizeExtractedText(rawText: string): string {
  return rawText
    .replace(/\u0000/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function looksThinExtractedText(text: string): boolean {
  return normalizeExtractedText(text).length < OCR_MIN_TEXT_CHARS;
}

function decodePdfReaderText(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%20/gi, " ");
  }
}

function buildPrioritizedSourceText(text: string): { text: string; sourceTextLength: number; sourceTextTruncated: boolean } {
  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    return { text: "", sourceTextLength: 0, sourceTextTruncated: false };
  }

  if (normalized.length <= MAX_PARSE_SOURCE_TEXT_CHARS) {
    return {
      text: normalized,
      sourceTextLength: normalized.length,
      sourceTextTruncated: false,
    };
  }

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const picked: string[] = [];
  const seen = new Set<string>();
  const addLine = (line: string) => {
    const normalizedLine = line.trim();
    if (!normalizedLine) return;
    const key = normalizedLine.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(normalizedLine);
  };
  const addWindow = (index: number, before: number, after: number) => {
    for (let pointer = Math.max(0, index - before); pointer <= Math.min(lines.length - 1, index + after); pointer += 1) {
      addLine(lines[pointer]!);
    }
  };

  lines.slice(0, 50).forEach(addLine);
  lines.forEach((line, index) => {
    const lowered = line.toLowerCase();
    if (/@/.test(line) || /\+?\d[\d\s().-]{7,}\d/.test(line) || /linkedin|github|portfolio|www\./i.test(line)) {
      addWindow(index, 0, 0);
    }
    if (ALL_SECTION_HEADINGS.some((heading) => lowered.includes(heading.toLowerCase()))) {
      addWindow(index, 0, 8);
    }
  });
  lines.slice(-20).forEach(addLine);

  let compactText = picked.join("\n").trim();
  if (compactText.length < Math.round(MAX_PARSE_SOURCE_TEXT_CHARS * 0.55)) {
    compactText = [...lines.slice(0, 90), ...picked]
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line, index, all) => all.findIndex((item) => item.toLowerCase() === line.toLowerCase()) === index)
      .join("\n")
      .trim();
  }

  return {
    text: compactText.slice(0, MAX_PARSE_SOURCE_TEXT_CHARS).trim(),
    sourceTextLength: normalized.length,
    sourceTextTruncated: true,
  };
}

function createExtractionDebug(partial?: Partial<ExtractionDebug>): ExtractionDebug {
  return {
    extractionMethod: partial?.extractionMethod ?? null,
    extractionFallbackUsed: partial?.extractionFallbackUsed ?? false,
    extractionFailureClass: partial?.extractionFailureClass ?? null,
    sourceTextLength: partial?.sourceTextLength ?? null,
    sourceTextTruncated: partial?.sourceTextTruncated ?? false,
  };
}

function stripListPrefix(line: string): string {
  return line.replace(/^[•*+\-–]\s*/, "").trim();
}

function looksLikeDateRangeLine(line?: string | null): boolean {
  if (!line) return false;
  return DATE_RANGE_REGEX.test(line);
}

function splitDateRange(line?: string | null): { startDate: string | null; endDate: string | null } {
  const normalized = normalizeString(line);
  if (!normalized) return { startDate: null, endDate: null };
  const match = normalized.match(DATE_RANGE_REGEX);
  const target = match?.[0] ?? normalized;
  const parts = target.split(/[-–]/).map((item) => normalizeString(item)).filter((item): item is string => Boolean(item));
  return {
    startDate: parts[0] ?? null,
    endDate: parts[1] ?? null,
  };
}

function looksLikeRoleLine(line?: string | null): boolean {
  const normalized = normalizeString(line);
  return Boolean(normalized && TITLE_HINT_REGEX.test(normalized) && !looksLikeDateRangeLine(normalized));
}

function looksLikeCompanyLine(line?: string | null): boolean {
  const normalized = normalizeString(line);
  return Boolean(normalized && !looksLikeDateRangeLine(normalized) && !/[@/]/.test(normalized) && COMPANY_HINT_REGEX.test(normalized));
}

function looksLikeEducationInstitution(line?: string | null) {
  const normalized = normalizeString(line);
  return Boolean(normalized && INSTITUTION_HINT_REGEX.test(normalized));
}

function looksLikeDegreeLine(line?: string | null) {
  const normalized = normalizeString(line);
  return Boolean(normalized && DEGREE_HINT_REGEX.test(normalized));
}

function deriveStatus(candidate: ParsedCandidate): ParsedCandidate["parseStatus"] {
  if (candidate.parseStatus === "parsed" || candidate.parseStatus === "partial" || candidate.parseStatus === "failed") {
    return candidate.parseStatus;
  }
  const essentialHits = [candidate.firstName || candidate.lastName, candidate.email, candidate.currentTitle, candidate.summary]
    .filter(Boolean).length;
  if (essentialHits === 0) return "failed";
  if (candidate.parseReviewRequired || (candidate.parseConfidence ?? 0) < 65) return "partial";
  return "parsed";
}

function sanitizeStandardizedProfile(value: string | null): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const parts = normalized
    .split(/\||\n/)
    .map((part) => normalizeString(part))
    .filter((part): part is string => Boolean(part))
    .filter((part) => !NULLISH_STRINGS.has(part.toLowerCase()));
  if (!parts.length) return null;
  return Array.from(new Set(parts)).join(" | ");
}

function dedupeList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function splitLooseList(value: string | null): string[] {
  const normalized = normalizeString(value);
  if (!normalized) return [];
  return normalized
    .split(/,|\/|\||•|·/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatNaturalList(values: string[], conjunction = "and"): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values.at(-1)}`;
}

function formatExperienceYears(yearsExperience: number | null): string | null {
  if (yearsExperience == null || yearsExperience <= 0) return null;
  return yearsExperience === 1 ? "1 year" : `${yearsExperience} years`;
}

function getPrimaryTitle(candidate: ParsedCandidate): string | null {
  return (
    normalizeString(candidate.currentTitle) ??
    candidate.parsedExperience.map((item) => normalizeString(item.title)).find(Boolean) ??
    null
  );
}

function getSummarySkills(candidate: ParsedCandidate): string[] {
  return dedupeList([
    ...candidate.parsedSkills,
    ...splitLooseList(candidate.skills),
  ]).slice(0, 5);
}

function getExperienceHighlights(candidate: ParsedCandidate): string[] {
  return dedupeList(
    candidate.parsedExperience.flatMap((item) =>
      (item.highlights ?? [])
        .map((highlight) => normalizeString(highlight))
        .filter((highlight): highlight is string => Boolean(highlight))
        .filter((highlight) => highlight.length >= 8),
    ),
  ).slice(0, 3);
}

function getEducationSummary(candidate: ParsedCandidate): string | null {
  const parsed = dedupeList(
    candidate.parsedEducation.flatMap((item) =>
      [item.degree, item.fieldOfStudy, item.institution].filter((value): value is string => Boolean(value)),
    ),
  );

  if (parsed.length) {
    return formatNaturalList(parsed.slice(0, 2));
  }

  return normalizeString(candidate.education);
}

function getLanguagesSummary(candidate: ParsedCandidate): string[] {
  const explicitItems = candidate.languageItems
    .map((item) => {
      if (!item.name) return null;
      return item.level ? `${item.name} (${item.level})` : item.name;
    })
    .filter((item): item is string => Boolean(item));

  return dedupeList([...explicitItems, ...splitLooseList(candidate.languages)]).slice(0, 3);
}

function buildProfessionalSummary(candidate: ParsedCandidate): string | null {
  const title = getPrimaryTitle(candidate);
  const years = formatExperienceYears(candidate.yearsExperience);
  const location = normalizeString(candidate.location);
  const skills = getSummarySkills(candidate);
  const education = getEducationSummary(candidate);
  const languages = getLanguagesSummary(candidate);
  const highlights = getExperienceHighlights(candidate);
  const existingSummary = normalizeString(candidate.summary);
  const experienceSignals = dedupeList(
    candidate.parsedExperience.flatMap((item) =>
      [item.title, item.company]
        .map((value) => normalizeString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 2);
  const decisionMeta = dedupeList([
    location ? `Based in ${location}` : null,
    languages.length ? `Languages include ${formatNaturalList(languages)}` : null,
    candidate.expectedSalary != null ? inferSalarySignal(candidate) : null,
  ].filter((value): value is string => Boolean(value)));
  const sentences: string[] = [];

  if (title) {
    const intro = [
      title,
      years ? `with ${years} of experience` : null,
      location ? `based in ${location}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    sentences.push(`${intro}.`);
  } else if (years && location) {
    sentences.push(`Candidate based in ${location} with ${years} of relevant experience.`);
  } else if (years) {
    sentences.push(`Candidate with ${years} of relevant experience.`);
  } else if (location) {
    sentences.push(`Candidate based in ${location}.`);
  }

  if (skills.length) {
    sentences.push(`Core strengths are concentrated around ${formatNaturalList(skills.slice(0, 4))}.`);
  } else if (experienceSignals.length) {
    sentences.push(`Recent work includes ${formatNaturalList(experienceSignals)}.`);
  } else if (highlights.length) {
    sentences.push(`Recent experience signals include ${formatNaturalList(highlights.slice(0, 2))}.`);
  }

  if (highlights.length) {
    sentences.push(`Recent work highlights include ${formatNaturalList(highlights.slice(0, 2))}.`);
  } else if (education) {
    sentences.push(`Education background includes ${education}.`);
  }

  if (decisionMeta.length) {
    sentences.push(`${decisionMeta.join(". ")}.`);
  } else if (education && languages.length) {
    sentences.push(`Education includes ${education}, and languages include ${formatNaturalList(languages)}.`);
  } else if (education) {
    sentences.push(`Education includes ${education}.`);
  } else if (languages.length) {
    sentences.push(`Languages include ${formatNaturalList(languages)}.`);
  }

  if (!sentences.length) {
    return existingSummary;
  }

  return sentences.slice(0, 4).join(" ");
}

function buildFallbackSummary(candidate: ParsedCandidate): string | null {
  return buildProfessionalSummary(candidate);
}

function extractLikelyTitle(lines: string[]): string | null {
  const titleKeywords =
    /\b(operator|engineer|developer|manager|specialist|technician|analyst|consultant|designer|coordinator|welder|machinist|accountant|assistant|tora|cnc)\b/i;

  for (const line of lines.slice(0, 12)) {
    if (!line || /@|http|linkedin|github|\d{5,}/i.test(line)) continue;
    if (line.length > 90) continue;
    const normalized = normalizeHeading(line);
    if (ALL_SECTION_HEADINGS.includes(normalized)) continue;
    const compact = normalizeString(line.split(/\s*[|•·]\s*/)[0] ?? line);
    if (compact && compact.length <= 80 && titleKeywords.test(compact)) {
      return compact;
    }
  }

  const fallback = normalizeString((lines[1] ?? "").split(/\s*[|•·]\s*/)[0] ?? null);
  if (fallback && !/@|http|\d{5,}/.test(fallback)) {
    return fallback;
  }

  return null;
}

function extractLanguagesFromBody(text: string): string | null {
  const knownLanguages = [
    "English",
    "Turkish",
    "German",
    "French",
    "Arabic",
    "Russian",
    "Spanish",
  ];
  const matches = knownLanguages.filter((language) => new RegExp(`\\b${language}\\b`, "i").test(text));
  return matches.length ? Array.from(new Set(matches)).join(", ") : null;
}

function extractEducationFromBody(lines: string[]): string | null {
  const educationKeywords =
    /\b(university|college|institute|school|bachelor|master|degree|diploma|lise|üniversite|faculty)\b/i;
  const matches = lines.filter((line) => educationKeywords.test(line)).slice(0, 3);
  return matches.length ? matches.join(" | ") : null;
}

function buildStandardizedProfile(candidate: ParsedCandidate): string | null {
  const provided = sanitizeStandardizedProfile(candidate.standardizedProfile);
  if (provided) return provided;
  const headline = candidate.currentTitle || [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || null;
  const contact = [candidate.email, candidate.phone].filter(Boolean).join(" | ") || null;
  const location = candidate.location || null;
  const experience = candidate.yearsExperience != null ? `${candidate.yearsExperience} years` : null;
  const skills = candidate.parsedSkills.length ? candidate.parsedSkills.join(", ") : candidate.skills;
  const education = candidate.education;
  const languages = candidate.languages;
  const sections = [
    headline ? `Headline: ${headline}` : null,
    contact ? `Contact: ${contact}` : null,
    location ? `Location: ${location}` : null,
    experience ? `Experience: ${experience}` : null,
    skills ? `Skills: ${skills}` : null,
    education ? `Education: ${education}` : null,
    languages ? `Languages: ${languages}` : null,
  ].filter(Boolean);
  return sections.length ? sections.join("\n") : null;
}

function looksCurrentValue(value?: string | null) {
  return Boolean(value && /\b(current|present|now|ongoing)\b/i.test(value));
}

function inferSenioritySignal(candidate: ParsedCandidate): string | null {
  const title = (candidate.currentTitle || candidate.parsedExperience[0]?.title || "").toLowerCase();
  const years = candidate.yearsExperience ?? 0;

  if (/\b(principal|staff|head|director)\b/.test(title)) return "Principal-level profile";
  if (/\b(lead|manager)\b/.test(title)) return "Lead-level profile";
  if (/\b(senior|sr)\b/.test(title) || years >= 8) return "Senior-level profile";
  if (years >= 5) return "Mid-to-senior profile";
  if (years >= 3) return "Mid-level profile";
  if (years > 0) return "Early-career profile";
  return title ? "Experience level inferred from current title" : null;
}

function inferWorkModel(candidate: ParsedCandidate): string | null {
  const text = [candidate.location, candidate.summary, candidate.standardizedProfile].filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (/\bremote\b/.test(text)) return "Remote-friendly";
  if (/\bhybrid\b/.test(text)) return "Hybrid-friendly";
  if (/\boffice|on-site|onsite\b/.test(text)) return "Office-based";
  return null;
}

function inferLocationFlexibility(candidate: ParsedCandidate): string | null {
  const workModel = inferWorkModel(candidate);
  if (candidate.location && workModel) return `${candidate.location} • ${workModel}`;
  if (candidate.location) return `Based in ${candidate.location}`;
  return workModel;
}

function inferSalarySignal(candidate: ParsedCandidate): string | null {
  if (candidate.expectedSalary != null) {
    return `Compensation expectation captured at ${Math.round(candidate.expectedSalary).toLocaleString("tr-TR")} TL`;
  }
  return null;
}

function normalizeFocusKeywords(value?: string | null) {
  return new Set(
    (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü\s]+/gi, " ")
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter(
        (part) =>
          part.length > 2 &&
          ![
            "senior",
            "junior",
            "lead",
            "staff",
            "principal",
            "associate",
            "intern",
            "full",
            "part",
            "time",
            "remote",
            "hybrid",
            "based",
            "candidate",
            "profile",
          ].includes(part),
      ),
  );
}

function deriveDomainFocus(candidate: ParsedCandidate): string[] {
  const titleKeywords = normalizeFocusKeywords(candidate.currentTitle);
  const summaryKeywords = normalizeFocusKeywords(candidate.summary);
  const skillSignals = getSummarySkills(candidate);
  const highlightKeywords = dedupeList(
    candidate.parsedExperience.flatMap((item) =>
      [...(item.techStack ?? []), ...(item.impactHighlights ?? []), ...(item.highlights ?? [])]
        .flatMap((value) => normalizeStringList(String(value))),
    ),
  );

  return dedupeList([
    ...skillSignals,
    ...[...titleKeywords].slice(0, 2),
    ...[...summaryKeywords].slice(0, 2),
    ...highlightKeywords,
  ]).slice(0, 5);
}

function deriveLanguageItems(candidate: ParsedCandidate): ParsedLanguageItem[] {
  const raw = normalizeString(candidate.languages);
  if (!raw) return [];

  return dedupeList(
    raw
      .split(/,|\/|\||•|·/)
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item)),
  )
    .map((entry) => {
      const levelMatch = entry.match(/^(.*?)(?:\s*[:(-]\s*|\s+)(A1|A2|B1|B2|C1|C2|native|fluent|professional|advanced|intermediate|basic)(?:\)|\s*)?$/i);
      if (levelMatch) {
        return {
          name: normalizeString(levelMatch[1]),
          level: normalizeString(levelMatch[2]),
          confidence: 86,
          source: "parsed-text",
        };
      }

      return {
        name: entry,
        level: null,
        confidence: 70,
        source: "parsed-text",
      };
    })
    .filter((item) => item.name);
}

function buildFieldConfidence(candidate: ParsedCandidate): ParsedFieldConfidence {
  const base = candidate.parseConfidence ?? 50;
  const score = (boost: number, penalty = 0) => Math.max(15, Math.min(100, Math.round(base + boost - penalty)));

  return {
    contact: score(candidate.email ? 12 : -10, candidate.phone ? 0 : 14),
    experience: score(candidate.parsedExperience.length ? 8 : -12, candidate.parsedExperience.length >= 2 ? 0 : 10),
    education: score(candidate.parsedEducation.length ? 6 : -8),
    languages: score(candidate.languages || candidate.languageItems.length ? 5 : -10),
    compensation: score(candidate.expectedSalary != null ? 6 : -12),
    summary: score(candidate.summary ? 8 : -12, candidate.standardizedProfile ? 0 : 6),
  };
}

function enrichExperienceItems(candidate: ParsedCandidate): ParsedExperienceItem[] {
  return candidate.parsedExperience.map((item) => {
    const highlights = dedupeList(item.highlights ?? []).slice(0, 4);
    const impactHighlights = dedupeList([
      ...(item.impactHighlights ?? []),
      ...highlights.filter((highlight) =>
        /\b(improved|reduced|built|designed|delivered|implemented|tested|led|owned|automated|optimized|developed|created|launched)\b/i.test(
          highlight,
        ),
      ),
    ]).slice(0, 3);
    const techStack = dedupeList([
      ...(item.techStack ?? []),
      ...getSummarySkills(candidate).filter((skill) =>
        highlights.join(" ").toLowerCase().includes(skill.toLowerCase()) ||
        (item.title || "").toLowerCase().includes(skill.toLowerCase()),
      ),
    ]).slice(0, 5);
    const scope = item.scope ?? normalizeString(
      [
        item.title,
        item.company ? `at ${item.company}` : null,
        item.startDate || item.endDate
          ? `during ${[item.startDate, item.endDate].filter(Boolean).join(" - ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );

    return {
      ...item,
      current: item.current ?? (item.endDate ? looksCurrentValue(item.endDate) : null),
      scope,
      techStack: techStack.length ? techStack : null,
      impactHighlights: impactHighlights.length ? impactHighlights : highlights.slice(0, 3),
      seniorityContribution:
        item.seniorityContribution ??
        normalizeString(
          [item.title, inferSenioritySignal(candidate)]
            .filter(Boolean)
            .join(" • "),
        ),
    };
  });
}

function enrichEducationItems(candidate: ParsedCandidate): ParsedEducationItem[] {
  return candidate.parsedEducation.map((item) => {
    const fieldCount = [item.institution, item.degree, item.fieldOfStudy, item.startDate, item.endDate].filter(Boolean).length;
    return {
      ...item,
      confidence: item.confidence ?? Math.min(95, 40 + fieldCount * 12),
    };
  });
}

function deriveNotableAchievements(candidate: ParsedCandidate): string[] {
  return dedupeList(
    candidate.parsedExperience.flatMap((item) => item.impactHighlights ?? item.highlights ?? []),
  ).slice(0, 4);
}

function buildExecutiveHeadline(candidate: ParsedCandidate): string | null {
  const title = getPrimaryTitle(candidate);
  const years = formatExperienceYears(candidate.yearsExperience);
  const focus = deriveDomainFocus(candidate);

  if (!title && !focus.length) return null;

  const parts = [
    title,
    years ? `with ${years}` : null,
    focus.length ? `across ${formatNaturalList(focus.slice(0, 3), "and")}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" ") : null;
}

function buildProfessionalSnapshot(candidate: ParsedCandidate): string | null {
  const title = getPrimaryTitle(candidate);
  const years = formatExperienceYears(candidate.yearsExperience);
  const focus = deriveDomainFocus(candidate);
  const languages = deriveLanguageItems(candidate).map((item) => item.level ? `${item.name} (${item.level})` : item.name).filter(Boolean) as string[];
  const achievements = deriveNotableAchievements(candidate);
  const sentences: string[] = [];

  if (title) {
    const intro = [
      title,
      years ? `with ${years} of experience` : null,
      candidate.location ? `based in ${candidate.location}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    sentences.push(`${intro}.`);
  }

  if (focus.length) {
    sentences.push(`The profile is most credible around ${formatNaturalList(focus.slice(0, 4))}.`);
  }

  if (achievements.length) {
    sentences.push(`The strongest work signals point to ${formatNaturalList(achievements.slice(0, 2))}.`);
  }

  if (languages.length || candidate.expectedSalary != null) {
    const meta = [
      languages.length ? `Languages: ${formatNaturalList(languages)}` : null,
      candidate.expectedSalary != null ? inferSalarySignal(candidate) : null,
    ]
      .filter(Boolean)
      .join(". ");
    if (meta) sentences.push(`${meta}.`);
  }

  return sentences.length ? sentences.slice(0, 4).join(" ") : buildProfessionalSummary(candidate);
}

function buildDeterministicEnrichment(candidate: ParsedCandidate): ParsedCandidate {
  const enrichedExperience = enrichExperienceItems(candidate);
  const enrichedEducation = enrichEducationItems(candidate);
  const languageItems = deriveLanguageItems(candidate);
  const domainFocus = deriveDomainFocus(candidate);
  const notableAchievements = deriveNotableAchievements({ ...candidate, parsedExperience: enrichedExperience });
  const fieldConfidence = buildFieldConfidence({ ...candidate, parsedExperience: enrichedExperience, parsedEducation: enrichedEducation, languageItems } as ParsedCandidate);
  const candidateStrengths = dedupeList(
    [
      getPrimaryTitle(candidate),
      candidate.yearsExperience != null ? `${candidate.yearsExperience} years of experience` : null,
      ...domainFocus,
      ...notableAchievements,
      languageItems.length
        ? `Languages: ${formatNaturalList(
            languageItems
              .map((item) => (item.level ? `${item.name} (${item.level})` : item.name))
              .filter(Boolean) as string[],
          )}`
        : null,
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 6);

  const candidateRisks = dedupeList(
    [
      !candidate.phone ? "Phone number is missing" : null,
      candidate.expectedSalary == null ? "Compensation expectations are missing" : null,
      !enrichedExperience.length ? "Experience structure is thin" : null,
      !enrichedEducation.length ? "Education structure is thin" : null,
      !languageItems.length ? "Language coverage is still unclear" : null,
      candidate.parseReviewRequired ? "Some profile details still need confirmation" : null,
      (candidate.parseConfidence ?? 0) < 70 ? `Parse confidence is ${candidate.parseConfidence ?? 0}%` : null,
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 6);

  const evidence = dedupeList(
    [
      getPrimaryTitle(candidate) ? `Title signal: ${getPrimaryTitle(candidate)}` : null,
      candidate.location ? `Location signal: ${candidate.location}` : null,
      domainFocus.length ? `Domain signal: ${formatNaturalList(domainFocus.slice(0, 3))}` : null,
      enrichedExperience[0]?.company ? `Employer signal: ${enrichedExperience[0].company}` : null,
      notableAchievements[0] ? `Achievement signal: ${notableAchievements[0]}` : null,
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 6);

  return {
    ...candidate,
    parsedExperience: enrichedExperience,
    parsedEducation: enrichedEducation,
    languageItems,
    fieldConfidence,
    executiveHeadline: candidate.executiveHeadline ?? buildExecutiveHeadline(candidate),
    professionalSnapshot: candidate.professionalSnapshot ?? buildProfessionalSnapshot(candidate),
    domainFocus,
    senioritySignal: candidate.senioritySignal ?? inferSenioritySignal(candidate),
    candidateStrengths,
    candidateRisks,
    notableAchievements,
    inferredWorkModel: candidate.inferredWorkModel ?? inferWorkModel(candidate),
    locationFlexibility: candidate.locationFlexibility ?? inferLocationFlexibility(candidate),
    salarySignal: candidate.salarySignal ?? inferSalarySignal(candidate),
    evidence,
  };
}

function hasUsefulSignals(candidate: ParsedCandidate): boolean {
  return Boolean(
    candidate.firstName ||
      candidate.lastName ||
      candidate.email ||
      candidate.phone ||
      candidate.currentTitle ||
      candidate.summary ||
      candidate.parsedSkills.length ||
      candidate.parsedExperience.length ||
      candidate.parsedEducation.length,
  );
}

function normalizeHeading(line: string): string {
  return line.toLowerCase().replace(/[:\-\u2022]/g, " ").replace(/\s+/g, " ").trim();
}

function getDocumentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildPrioritizedResumeText(text: string, maxChars: number): { text: string; trimmed: boolean } {
  const normalized = normalizeExtractedText(text);
  if (normalized.length <= maxChars) {
    return { text: normalized, trimmed: false };
  }

  const lines = getDocumentLines(normalized);
  const topLines = lines.slice(0, 12);
  const experienceLines = getSectionLines(lines, SECTION_HEADINGS.experience, 18);
  const skillsLines = getSectionLines(lines, SECTION_HEADINGS.skills, 12);
  const summaryLines = getSectionLines(lines, SECTION_HEADINGS.summary, 8);
  const educationLines = getSectionLines(lines, SECTION_HEADINGS.education, 8);
  const languageLines = getSectionLines(lines, SECTION_HEADINGS.languages, 6);
  const tailLines = lines.slice(-10);

  const prioritizedLines = dedupeList([
    ...topLines,
    ...summaryLines,
    ...experienceLines,
    ...skillsLines,
    ...educationLines,
    ...languageLines,
    ...tailLines,
  ]);

  const prioritized = prioritizedLines.join("\n").trim();
  if (prioritized.length && prioritized.length <= maxChars) {
    return { text: prioritized, trimmed: true };
  }

  return {
    text: prioritized.slice(0, maxChars).trim() || normalized.slice(0, maxChars).trim(),
    trimmed: true,
  };
}

function getSectionLines(lines: string[], headings: readonly string[], maxLines = 12): string[] {
  const startIndex = lines.findIndex((line) => {
    const normalized = normalizeHeading(line);
    return headings.some((heading) => normalized === heading || normalized.startsWith(`${heading} `));
  });
  if (startIndex === -1) return [];

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeHeading(line);
    const isAnotherHeading = ALL_SECTION_HEADINGS.some(
      (heading) => normalized === heading || normalized.startsWith(`${heading} `),
    );
    if (isAnotherHeading) break;
    collected.push(line);
    if (collected.length >= maxLines) break;
  }
  return collected;
}

function parseHeuristicExperience(lines: string[]): ParsedExperienceItem[] {
  const cleaned = lines.map((line) => stripListPrefix(line)).filter(Boolean);
  if (!cleaned.length) return [];

  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of cleaned) {
    const startsNewBlock =
      currentBlock.length > 0 &&
      (
        (looksLikeDateRangeLine(line) && currentBlock.some((item) => looksLikeDateRangeLine(item))) ||
        (looksLikeRoleLine(line) && currentBlock.some((item) => looksLikeDateRangeLine(item)))
      );

    if (startsNewBlock) {
      blocks.push(currentBlock);
      currentBlock = [line];
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock.length) {
    blocks.push(currentBlock);
  }

  return blocks
    .map((block) => {
      const dateLine = block.find((line) => looksLikeDateRangeLine(line)) ?? null;
      const { startDate, endDate } = splitDateRange(dateLine);
      const title = block.find((line) => looksLikeRoleLine(line)) ?? normalizeString(block[0]);
      const company = block.find((line) => looksLikeCompanyLine(line) && normalizeString(line) !== normalizeString(title)) ?? null;
      const highlights = block
        .filter((line) => line !== dateLine && line !== title && line !== company)
        .map((line) => normalizeString(line))
        .filter((line): line is string => typeof line === "string" && line.length > 10)
        .slice(0, 4);

      return {
        title: normalizeString(title),
        company: normalizeString(company),
        startDate,
        endDate,
        highlights,
        scope: normalizeString([title, company].filter(Boolean).join(" at ")),
        techStack: null,
        impactHighlights: highlights.filter((line) =>
          /\b(improved|reduced|built|designed|delivered|implemented|tested|led|owned|automated|optimized|developed|created|launched)\b/i.test(
            line,
          ),
        ),
        current: endDate ? looksCurrentValue(endDate) : null,
        seniorityContribution: null,
      };
    })
    .filter((item) => item.title || item.company || item.highlights.length || item.startDate || item.endDate)
    .slice(0, 4);
}

function parseHeuristicEducation(lines: string[]): ParsedEducationItem[] {
  const cleaned = lines.map((line) => stripListPrefix(line)).filter(Boolean);
  if (!cleaned.length) return [];

  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of cleaned) {
    const startsNewBlock =
      currentBlock.length > 0 &&
      (
        (looksLikeEducationInstitution(line) && currentBlock.some((item) => looksLikeEducationInstitution(item))) ||
        (looksLikeDegreeLine(line) && currentBlock.some((item) => looksLikeDegreeLine(item)))
      );

    if (startsNewBlock) {
      blocks.push(currentBlock);
      currentBlock = [line];
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock.length) {
    blocks.push(currentBlock);
  }

  return blocks
    .map((block) => {
      const institution = block.find((line) => looksLikeEducationInstitution(line)) ?? null;
      const degree = block.find((line) => looksLikeDegreeLine(line)) ?? null;
      const dateLine = block.find((line) => looksLikeDateRangeLine(line)) ?? null;
      const { startDate, endDate } = splitDateRange(dateLine);
      const fieldOfStudy = block
        .filter((line) => line !== institution && line !== degree && line !== dateLine)
        .map((line) => normalizeString(line))
        .find((line): line is string => Boolean(line)) ?? null;
      const confidence =
        (institution ? 35 : 0) +
        (degree ? 35 : 0) +
        (fieldOfStudy ? 15 : 0) +
        (startDate || endDate ? 15 : 0);

      return {
        institution: normalizeString(institution),
        degree: normalizeString(degree),
        fieldOfStudy,
        startDate,
        endDate,
        confidence: confidence || null,
      };
    })
    .filter((item) => item.institution || item.degree || item.fieldOfStudy)
    .slice(0, 3);
}

function extractName(lines: string[]): { firstName: string | null; lastName: string | null } {
  for (const line of lines.slice(0, 6)) {
    if (/@|http|\d/.test(line)) continue;
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 4) continue;
    const looksLikeName = tokens.every((token) => /^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'`.-]+$/.test(token) || /^[A-ZÇĞİÖŞÜ]{2,}$/.test(token));
    if (!looksLikeName) continue;
    return {
      firstName: tokens[0] ?? null,
      lastName: tokens.slice(1).join(" ") || null,
    };
  }
  return { firstName: null, lastName: null };
}

function findLikelyPhone(text: string): string | null {
  const matches = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/g) ?? [];
  for (const match of matches) {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;
    if (/^(19|20)\d{6,}$/.test(digits)) continue;
    const normalized = normalizePhone(match.replace(/\s{2,}/g, " ").trim());
    if (normalized) return normalized;
  }
  return null;
}

function collectFallbackExperienceLines(lines: string[]): string[] {
  const sectionLines = getSectionLines(lines, SECTION_HEADINGS.experience, 24);
  if (sectionLines.length) return sectionLines;

  return lines
    .map((line) => stripListPrefix(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => looksLikeDateRangeLine(line) || looksLikeRoleLine(line) || looksLikeCompanyLine(line))
    .slice(0, 28);
}

function collectFallbackEducationLines(lines: string[]): string[] {
  const sectionLines = getSectionLines(lines, SECTION_HEADINGS.education, 12);
  if (sectionLines.length) return sectionLines;

  return lines
    .map((line) => stripListPrefix(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => looksLikeEducationInstitution(line) || looksLikeDegreeLine(line))
    .slice(0, 12);
}

function extractHeuristicCandidate(cvText: string): ParsedCandidate {
  const lines = getDocumentLines(cvText);
  const normalizedText = cvText.replace(/\u00a0/g, " ").trim();
  const { firstName, lastName } = extractName(lines);
  const email = normalizedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = findLikelyPhone(normalizedText);
  const yearsExperience =
    toNumber(normalizedText.match(/(\d{1,2})\+?\s+(?:years?|yrs?)/i)?.[1] ?? null) ??
    toNumber(normalizedText.match(/experience[^.\n]{0,20}(\d{1,2})/i)?.[1] ?? null);
  const skillsLines = getSectionLines(lines, SECTION_HEADINGS.skills);
  const languagesLines = getSectionLines(lines, SECTION_HEADINGS.languages, 6);
  const educationLines = collectFallbackEducationLines(lines);
  const summaryLines = getSectionLines(lines, SECTION_HEADINGS.summary, 5);
  const experienceLines = collectFallbackExperienceLines(lines);

  const currentTitle = extractLikelyTitle(lines);

  const parsedSkills = normalizeStringList(
    skillsLines
      .join(", ")
      .replace(/[•·]/g, ",")
      .replace(/\s{2,}/g, " "),
  );

  const languages =
    normalizeString(
      languagesLines
        .join(", ")
        .replace(/[•·]/g, ",")
        .replace(/\s{2,}/g, " "),
    ) ?? extractLanguagesFromBody(normalizedText);

  const education = normalizeString(educationLines.join(" | ")) ?? extractEducationFromBody(lines);
  const summaryCandidate = normalizeString(summaryLines.join(" "));
  const summary = summaryCandidate && summaryCandidate.length <= 420 ? summaryCandidate : null;
  const parsedExperience = parseHeuristicExperience(experienceLines);
  const parsedEducation = parseHeuristicEducation(educationLines);

  const location =
    normalizeString(
      normalizedText.match(/\b(?:Istanbul|İstanbul|Ankara|Izmir|İzmir|Bursa|Kocaeli|Antalya|Adana|Konya|Sancaktepe|Bağcılar|Remote)(?:,\s*(?:Turkey|Türkiye))?\b/i)?.[0] ??
        null,
    ) ??
    normalizeString(lines.find((line) => /^location[:\s-]/i.test(line))?.replace(/^location[:\s-]*/i, "") ?? null);

  const candidate = createEmptyParse("heuristic", "Structured extraction fell back to resume text heuristics.");
  candidate.firstName = firstName;
  candidate.lastName = lastName;
  candidate.email = email;
  candidate.phone = phone;
  candidate.currentTitle = currentTitle;
  candidate.location = location;
  candidate.skills = parsedSkills.length ? parsedSkills.join(", ") : null;
  candidate.parsedSkills = parsedSkills;
  candidate.education = education;
  candidate.languages = languages;
  candidate.summary = summary;
  candidate.yearsExperience = yearsExperience;
  candidate.parsedExperience = parsedExperience.length
    ? parsedExperience
    : currentTitle
      ? [
          {
            title: currentTitle,
            company: null,
            startDate: null,
            endDate: null,
            highlights: [],
            scope: null,
            techStack: null,
            impactHighlights: null,
            current: null,
            seniorityContribution: null,
          },
        ]
      : [];
  candidate.parsedEducation = parsedEducation;
  candidate.parseConfidence = Math.min(
    78,
    (candidate.firstName || candidate.lastName ? 20 : 0) +
      (candidate.email ? 20 : 0) +
      (candidate.phone ? 12 : 0) +
      (candidate.currentTitle ? 8 : 0) +
      (candidate.parsedSkills.length ? 8 : 0) +
      (candidate.summary ? 5 : 0) +
      (candidate.parsedExperience.length ? 3 : 0) +
      (candidate.parsedEducation.length ? 2 : 0),
  );
  candidate.parseStatus = hasUsefulSignals(candidate) ? "partial" : "failed";
  candidate.parseReviewRequired = true;
  candidate.standardizedProfile = buildStandardizedProfile(candidate);
  if (!candidate.summary) {
    candidate.summary = buildFallbackSummary(candidate);
  }
  return candidate;
}

function mergeParsedCandidates(primary: ParsedCandidate, fallback: ParsedCandidate): ParsedCandidate {
  const merged: ParsedCandidate = {
    ...fallback,
    ...primary,
    firstName: primary.firstName ?? fallback.firstName,
    lastName: primary.lastName ?? fallback.lastName,
    email: primary.email ?? fallback.email,
    phone: primary.phone ?? fallback.phone,
    skills: primary.skills ?? fallback.skills,
    expectedSalary: primary.expectedSalary ?? fallback.expectedSalary,
    currentTitle: primary.currentTitle ?? fallback.currentTitle,
    location: primary.location ?? fallback.location,
    yearsExperience: primary.yearsExperience ?? fallback.yearsExperience,
    education: primary.education ?? fallback.education,
    languages: primary.languages ?? fallback.languages,
    summary: primary.summary ?? fallback.summary,
    standardizedProfile: sanitizeStandardizedProfile(primary.standardizedProfile) ?? buildStandardizedProfile({ ...fallback, ...primary }),
    executiveHeadline: primary.executiveHeadline ?? fallback.executiveHeadline,
    professionalSnapshot: primary.professionalSnapshot ?? fallback.professionalSnapshot,
    domainFocus: primary.domainFocus.length ? primary.domainFocus : fallback.domainFocus,
    senioritySignal: primary.senioritySignal ?? fallback.senioritySignal,
    candidateStrengths: primary.candidateStrengths.length ? primary.candidateStrengths : fallback.candidateStrengths,
    candidateRisks: primary.candidateRisks.length ? primary.candidateRisks : fallback.candidateRisks,
    notableAchievements: primary.notableAchievements.length ? primary.notableAchievements : fallback.notableAchievements,
    inferredWorkModel: primary.inferredWorkModel ?? fallback.inferredWorkModel,
    locationFlexibility: primary.locationFlexibility ?? fallback.locationFlexibility,
    salarySignal: primary.salarySignal ?? fallback.salarySignal,
    languageItems: primary.languageItems.length ? primary.languageItems : fallback.languageItems,
    fieldConfidence: primary.fieldConfidence ?? fallback.fieldConfidence,
    evidence: primary.evidence.length ? primary.evidence : fallback.evidence,
    parsedSkills: primary.parsedSkills.length ? primary.parsedSkills : fallback.parsedSkills,
    parsedExperience: primary.parsedExperience.length ? primary.parsedExperience : fallback.parsedExperience,
    parsedEducation: primary.parsedEducation.length ? primary.parsedEducation : fallback.parsedEducation,
    parseConfidence: Math.max(primary.parseConfidence ?? 0, fallback.parseConfidence ?? 0),
    parseReviewRequired: primary.parseReviewRequired || fallback.parseReviewRequired,
    parseStatus:
      primary.parseStatus === "parsed"
        ? "parsed"
        : primary.parseStatus === "partial" || fallback.parseStatus === "partial"
          ? "partial"
          : fallback.parseStatus,
    warnings: Array.from(new Set([...fallback.warnings, ...primary.warnings])),
  };

  if (!merged.summary) {
    merged.summary = buildFallbackSummary(merged);
  }

  return merged;
}

function normalizeParsedCandidate(parsed: Record<string, unknown>, provider: string | null): ParsedCandidate {
  const parsedSkills = normalizeStringList(parsed.parsedSkills ?? parsed.skills);
  const parsedExperience = normalizeExperience(parsed.parsedExperience ?? parsed.experience);
  const parsedEducation = normalizeEducation(parsed.parsedEducation ?? parsed.educationItems);
  const languageItems = normalizeLanguageItems(parsed.languageItems);
  const parseConfidenceRaw = toNumber(parsed.parseConfidence);

  const candidate: ParsedCandidate = {
    firstName: normalizeString(parsed.firstName),
    lastName: normalizeString(parsed.lastName),
    email: normalizeEmail(parsed.email),
    phone: normalizePhone(parsed.phone),
    skills: normalizeString(parsed.skills) ?? (parsedSkills.length ? parsedSkills.join(", ") : null),
    expectedSalary: toNumber(parsed.expectedSalary),
    currentTitle: normalizeString(parsed.currentTitle),
    location: normalizeString(parsed.location),
    yearsExperience: toNumber(parsed.yearsExperience),
    education: normalizeString(parsed.education),
    languages: normalizeString(parsed.languages),
    summary: normalizeString(parsed.summary),
    standardizedProfile: sanitizeStandardizedProfile(normalizeString(parsed.standardizedProfile)),
    executiveHeadline: normalizeString(parsed.executiveHeadline),
    professionalSnapshot: normalizeString(parsed.professionalSnapshot),
    domainFocus: normalizeStringList(parsed.domainFocus),
    senioritySignal: normalizeString(parsed.senioritySignal),
    candidateStrengths: normalizeStringList(parsed.candidateStrengths),
    candidateRisks: normalizeStringList(parsed.candidateRisks),
    notableAchievements: normalizeStringList(parsed.notableAchievements),
    inferredWorkModel: normalizeString(parsed.inferredWorkModel),
    locationFlexibility: normalizeString(parsed.locationFlexibility),
    salarySignal: normalizeString(parsed.salarySignal),
    languageItems,
    fieldConfidence: normalizeFieldConfidence(parsed.fieldConfidence),
    evidence: normalizeStringList(parsed.evidence),
    parsedSkills,
    parsedExperience,
    parsedEducation,
    parseConfidence: parseConfidenceRaw == null ? null : Math.max(0, Math.min(100, Math.round(parseConfidenceRaw))),
    parseReviewRequired:
      typeof parsed.parseReviewRequired === "boolean"
        ? parsed.parseReviewRequired
        : [normalizeString(parsed.email), normalizeString(parsed.phone), normalizeString(parsed.currentTitle)].filter(Boolean).length < 2,
    parseStatus: "partial",
    parseProvider: provider,
    warnings: normalizeWarnings(parsed.warnings),
    extractionMethod: normalizeString(parsed.extractionMethod),
    extractionFallbackUsed: typeof parsed.extractionFallbackUsed === "boolean" ? parsed.extractionFallbackUsed : false,
    extractionFailureClass:
      normalizeString(parsed.extractionFailureClass) && ["runtime", "timeout", "empty_text", "oversized", "ocr_required"].includes(String(parsed.extractionFailureClass))
        ? (parsed.extractionFailureClass as ExtractionFailureClass)
        : null,
    sourceTextLength: toNumber(parsed.sourceTextLength),
    sourceTextTruncated: typeof parsed.sourceTextTruncated === "boolean" ? parsed.sourceTextTruncated : false,
  };

  if (candidate.parseConfidence == null) {
    const score =
      (candidate.firstName || candidate.lastName ? 20 : 0) +
      (candidate.email ? 20 : 0) +
      (candidate.phone ? 15 : 0) +
      (candidate.currentTitle ? 10 : 0) +
      (candidate.parsedSkills.length ? 10 : 0) +
      (candidate.summary ? 10 : 0) +
      (candidate.parsedExperience.length ? 10 : 0) +
      (candidate.parsedEducation.length ? 5 : 0);
    candidate.parseConfidence = score;
  }

  if (!candidate.summary) {
    candidate.summary = buildFallbackSummary(candidate);
  }
  candidate.standardizedProfile = buildStandardizedProfile(candidate);
  candidate.parseStatus = deriveStatus(candidate);
  return candidate;
}

async function extractTextFromPdfPrimary(buffer: Buffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const pages = Math.min(document.numPages, 6);
  const chunks: string[] = [];

  for (let index = 1; index <= pages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    if (pageText.trim()) {
      chunks.push(pageText);
    }
  }

  const text = normalizeExtractedText(chunks.join("\n"));
  if (!text) {
    throw new Error("PDF contains no readable text");
  }
  return text;
}

async function recognizeWithGoogleVision(image: Buffer): Promise<string> {
  if (!GOOGLE_VISION_API_KEY) {
    throw new Error("Google Vision OCR is not configured.");
  }

  const response = await fetch(`${GOOGLE_VISION_API_URL}?key=${encodeURIComponent(GOOGLE_VISION_API_KEY)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: image.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: OCR_LANGUAGES },
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string };
        responses?: Array<{
          fullTextAnnotation?: { text?: string };
          textAnnotations?: Array<{ description?: string }>;
        }>;
      }
    | null;

  if (!response.ok || payload?.error?.message) {
    throw new Error(payload?.error?.message || `Google Vision OCR request failed with ${response.status}`);
  }

  const text =
    payload?.responses?.[0]?.fullTextAnnotation?.text ??
    payload?.responses?.[0]?.textAnnotations?.[0]?.description ??
    "";
  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    throw new Error("Google Vision OCR returned no readable text");
  }
  return normalized;
}

async function renderPdfPagesForOcr(buffer: Buffer): Promise<Buffer[]> {
  await ensurePdfRuntimePolyfills();
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const images: Buffer[] = [];
  const pages = Math.min(document.numPages, OCR_PAGE_LIMIT);

  for (let index = 1; index <= pages; index += 1) {
    const page = await document.getPage(index);
    const viewport = page.getViewport({ scale: Math.max(2, OCR_RENDER_SCALE * 2) });
    const canvas = createNodeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context is unavailable for PDF OCR rendering");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context as any, viewport, canvas: canvas as any }).promise;
    const png = canvas.toBuffer("image/png");
    if (png?.length) {
      images.push(Buffer.from(png));
    }
  }

  if (!images.length) {
    throw new Error("PDF OCR rendering produced no page images");
  }

  return images;
}

async function recognizeImagesWithOcr(images: Buffer[]): Promise<string> {
  if (GOOGLE_VISION_API_KEY) {
    try {
      const chunks: string[] = [];
      for (const image of images.slice(0, OCR_PAGE_LIMIT)) {
        const text = await withTimeout(recognizeWithGoogleVision(image), OCR_TIMEOUT_MS, "Google Vision OCR");
        if (text) chunks.push(text);
      }
      const combined = normalizeExtractedText(chunks.join("\n\n"));
      if (combined) return combined;
      throw new Error("Google Vision OCR returned empty text");
    } catch (error) {
      console.warn("[CV Parse] Google Vision OCR failed, falling back to Tesseract.", error);
    }
  }

  const worker = await createWorker(OCR_LANGUAGES.join("+"));
  try {
    const chunks: string[] = [];
    for (const image of images.slice(0, OCR_PAGE_LIMIT)) {
      const result = await withTimeout(worker.recognize(image), OCR_TIMEOUT_MS, "OCR page recognition");
      const text = normalizeExtractedText(result.data.text || "");
      if (text) chunks.push(text);
    }
    return normalizeExtractedText(chunks.join("\n\n"));
  } finally {
    await worker.terminate();
  }
}

async function extractTextFromPdfOcr(buffer: Buffer): Promise<string> {
  try {
    const images = await renderPdfPagesForOcr(buffer);
    const text = await recognizeImagesWithOcr(images);
    if (!text) {
      throw new Error("PDF OCR fallback found no readable text");
    }
    return text;
  } catch (renderError) {
    console.warn("[CV Parse] PDF canvas OCR rendering failed, trying screenshot fallback.", renderError);
  }

  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: buffer });
  try {
    const screenshots = await parser.getScreenshot({
      first: OCR_PAGE_LIMIT,
      scale: OCR_RENDER_SCALE,
      imageDataUrl: false,
      imageBuffer: true,
    });

    const images = screenshots.pages
      .map((page) => Buffer.from(page.data))
      .filter((image) => image.length > 0);

    if (!images.length) {
      throw new Error("PDF OCR fallback could not render any pages");
    }

    const text = await recognizeImagesWithOcr(images);
    if (!text) {
      throw new Error("PDF OCR fallback found no readable text");
    }

    return text;
  } finally {
    await parser.destroy?.();
  }
}

async function extractTextFromImageOcr(buffer: Buffer): Promise<string> {
  const text = await recognizeImagesWithOcr([buffer]);
  if (!text) {
    throw new Error("Image OCR fallback found no readable text");
  }
  return text;
}

async function extractTextFromPdfFallback(buffer: Buffer): Promise<string> {
  const pageLines = new Map<string, Array<{ x: number; text: string }>>();

  await new Promise<void>((resolve, reject) => {
    new PdfReader().parseBuffer(buffer, (error, item) => {
      if (error) {
        reject(error);
        return;
      }
      if (!item) {
        resolve();
        return;
      }
      if (!item.text) return;

      const page = item.page || 1;
      const roundedY = Math.round(item.y * 100) / 100;
      const key = `${page}:${roundedY}`;
      const existing = pageLines.get(key) ?? [];
        existing.push({ x: item.x, text: decodePdfReaderText(item.text) });
      pageLines.set(key, existing);
    });
  });

  const normalized = normalizeExtractedText(
    [...pageLines.entries()]
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true }))
      .map(([, items]) => items.sort((left, right) => left.x - right.x).map((item) => item.text).join(""))
      .join("\n"),
  );
  if (!normalized) {
    throw new Error("PDF contains no readable text");
  }
  return normalized;
}

async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; debug: ExtractionDebug }> {
  let primaryError: unknown = null;
  let fallbackError: unknown = null;

  try {
    const text = await withTimeout(extractTextFromPdfPrimary(buffer), PDF_EXTRACTION_TIMEOUT_MS, "Primary PDF extraction");
    if (looksThinExtractedText(text)) {
      throw new Error("PDF extraction returned too little readable text");
    }
    const prepared = buildPrioritizedSourceText(text);
    return {
      text: prepared.text,
      debug: createExtractionDebug({
        extractionMethod: "pdf-parse",
        extractionFallbackUsed: false,
        extractionFailureClass: null,
        sourceTextLength: prepared.sourceTextLength,
        sourceTextTruncated: prepared.sourceTextTruncated,
      }),
    };
  } catch (error) {
    primaryError = error;
    console.warn("[CV Parse] Primary PDF extraction failed, trying fallback extractor.", error);
  }

  try {
    const text = await withTimeout(extractTextFromPdfFallback(buffer), PDF_EXTRACTION_TIMEOUT_MS, "Fallback PDF extraction");
    if (looksThinExtractedText(text)) {
      throw new Error("Fallback PDF extraction returned too little readable text");
    }
    const prepared = buildPrioritizedSourceText(text);
    return {
      text: prepared.text,
      debug: createExtractionDebug({
        extractionMethod: "pdfreader",
        extractionFallbackUsed: true,
        extractionFailureClass: null,
        sourceTextLength: prepared.sourceTextLength,
        sourceTextTruncated: prepared.sourceTextTruncated,
      }),
    };
  } catch (fallbackError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError || "");
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    fallbackError = fallbackError;
  }

  try {
    const text = await withTimeout(extractTextFromPdfOcr(buffer), OCR_TIMEOUT_MS, "PDF OCR extraction");
    const prepared = buildPrioritizedSourceText(text);
    return {
      text: prepared.text,
      debug: createExtractionDebug({
        extractionMethod: "ocr",
        extractionFallbackUsed: true,
        extractionFailureClass: null,
        sourceTextLength: prepared.sourceTextLength,
        sourceTextTruncated: prepared.sourceTextTruncated,
      }),
    };
  } catch (ocrError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError || "");
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError || "");
    const ocrMessage = ocrError instanceof Error ? ocrError.message : String(ocrError);
    const combinedError = new Error(
      [primaryMessage && `primary=${primaryMessage}`, fallbackMessage && `fallback=${fallbackMessage}`, ocrMessage && `ocr=${ocrMessage}`]
        .filter(Boolean)
        .join(" | ") || "PDF extraction failed",
    );
    (combinedError as Error & { failureClass?: ExtractionFailureClass }).failureClass =
      classifyExtractionError(ocrError || fallbackError || primaryError);
    throw combinedError;
  }
}

async function extractTextFromDocx(buffer: Buffer): Promise<{ text: string; debug: ExtractionDebug }> {
  const result = await withTimeout(mammoth.extractRawText({ buffer }), DOCX_EXTRACTION_TIMEOUT_MS, "DOCX extraction");
  const text = normalizeExtractedText(result.value);
  if (!text) {
    throw new Error("DOCX contains no readable text");
  }
  const prepared = buildPrioritizedSourceText(text);
  return {
    text: prepared.text,
    debug: createExtractionDebug({
      extractionMethod: "mammoth",
      extractionFallbackUsed: false,
      extractionFailureClass: null,
      sourceTextLength: prepared.sourceTextLength,
      sourceTextTruncated: prepared.sourceTextTruncated,
    }),
  };
}

async function readBinaryBody(req: Request, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  req.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBytes) {
      req.destroy(new Error(`Payload exceeds ${maxBytes} bytes`));
      return;
    }
    chunks.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    req.on("end", resolve);
    req.on("error", reject);
  });

  return Buffer.concat(chunks);
}

async function parseWithOpenAiText(cvText: string): Promise<ParsedCandidate> {
  const config = getAiClientConfig();
  if (!config) {
    return createEmptyParse(null, "No AI provider is configured for text normalization.");
  }

  const { client, models, provider } = config;
  const activeModels = getActiveProviderModels(models);
  const systemPrompt = buildUniversalPrompt();
  const preparedText = buildPrioritizedSourceText(cvText).text;
  let lastError: Error | null = null;

  for (const model of activeModels) {
    try {
      const completion = await withTimeout(
        client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                "Normalize the following resume text into the requested JSON.",
                "",
                preparedText.slice(0, MODEL_INPUT_CHAR_LIMIT),
              ].join("\n"),
            },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
        MODEL_TIMEOUT_MS,
        `Parse model ${provider}:${model}`,
      );

      const raw = completion.choices[0]?.message?.content ?? "{}";
      return normalizeParsedCandidate(extractJsonObject(raw), provider);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorMsg = lastError.message;
      console.warn(`[CV Parse] provider=${provider} model=${model} failed: ${errorMsg}`);
      if (isRetryableProviderError(errorMsg)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  return createEmptyParse(provider, lastError?.message || "All fallback text parsing models failed.");
}

async function parseWithGeminiDocument(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string | null;
}): Promise<ParsedCandidate> {
  const gemini = getGeminiClient();
  if (!gemini) {
    throw new Error("Gemini is not configured.");
  }

  const prompt = [
    buildUniversalPrompt(),
    "",
    params.fileName ? `File name: ${params.fileName}` : "",
    "Analyze the attached resume document directly. If the document is scanned, perform OCR mentally and still return partial structured output instead of failing.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await withTimeout(
    generateGeminiContent(gemini, {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.buffer.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
    DIRECT_DOCUMENT_TIMEOUT_MS,
    `${gemini.kind === "vertex" ? "Vertex AI" : "Gemini"} document parse ${gemini.model}`,
  );

  return normalizeParsedCandidate(extractJsonObject(raw), `${gemini.kind}:${gemini.model}`);
}

async function parseWithGeminiText(cvText: string): Promise<ParsedCandidate> {
  const gemini = getGeminiClient();
  if (!gemini) {
    throw new Error("Gemini is not configured.");
  }

  const preparedText = buildPrioritizedSourceText(cvText).text;
  const raw = await withTimeout(
    generateGeminiContent(gemini, {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [buildUniversalPrompt(), "", preparedText.slice(0, MODEL_INPUT_CHAR_LIMIT)].join("\n"),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
    MODEL_TIMEOUT_MS,
    `${gemini.kind === "vertex" ? "Vertex AI" : "Gemini"} text parse ${gemini.model}`,
  );

  return normalizeParsedCandidate(extractJsonObject(raw), `${gemini.kind}:${gemini.model}`);
}

function buildEnrichmentPrompt(
  candidate: ParsedCandidate,
  sourceText?: string,
  options?: { includeSourceText?: boolean; sourceCharLimit?: number },
) {
  const includeSourceText = options?.includeSourceText ?? true;
  const sourceCharLimit = options?.sourceCharLimit ?? ENRICHMENT_SOURCE_CHAR_LIMIT;
  const preparedSource =
    includeSourceText && sourceText ? buildPrioritizedSourceText(sourceText).text.slice(0, sourceCharLimit) : null;
  const candidateForEnrichment = {
    ...candidate,
    extractionMethod: undefined,
    extractionFallbackUsed: undefined,
    extractionFailureClass: undefined,
    sourceTextLength: undefined,
    sourceTextTruncated: undefined,
  };
  return [
    "You are enriching a structured candidate profile for a recruiter-facing briefing.",
    "Use only the evidence in the structured JSON and optional resume text. Never invent employers, dates, projects, skills, or education.",
    "Return exactly one JSON object and nothing else.",
    "Prefer short, factual, recruiter-friendly output.",
    "If a field is weak or unsupported, return null or an empty array.",
    "Update summary so it becomes a professional 3-4 sentence recruiter summary.",
    "executiveHeadline should be one short line, not a paragraph.",
    "professionalSnapshot should read like a polished candidate intro.",
    "candidateStrengths and candidateRisks should each contain concise evidence-based bullets.",
    "notableAchievements should only include concrete work signals already present in the source.",
    "parsedExperience may be enriched with scope, techStack, impactHighlights, current, and seniorityContribution only when supported.",
    "If parsedExperience has fewer than 2 entries but the source text clearly contains multiple role/date blocks, rebuild parsedExperience from that evidence.",
    "parsedEducation may be enriched with confidence only when support exists.",
    "If parsedEducation is too thin but the source text clearly contains multiple education signals, rebuild parsedEducation from that evidence.",
    "languageItems should include name, level, confidence, and source.",
    "fieldConfidence should include contact, experience, education, languages, compensation, summary as 0-100 integers.",
    "Required JSON keys: summary, executiveHeadline, professionalSnapshot, domainFocus, senioritySignal, candidateStrengths, candidateRisks, notableAchievements, inferredWorkModel, locationFlexibility, salarySignal, languageItems, fieldConfidence, evidence, parsedExperience, parsedEducation, standardizedProfile.",
    "",
    "Structured candidate JSON:",
    JSON.stringify(candidateForEnrichment),
    preparedSource
      ? ["", "Resume text excerpt:", preparedSource].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function enrichWithOpenAi(candidate: ParsedCandidate, sourceText?: string): Promise<ParsedCandidate | null> {
  const config = getAiClientConfig();
  if (!config) return null;

  const { client, models, provider } = config;
  const activeModels = getActiveProviderModels(models);
  const prompt = buildEnrichmentPrompt(candidate, sourceText, { includeSourceText: true });
  let lastError: Error | null = null;

  for (const model of activeModels) {
    try {
      const completion = await withTimeout(
        client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "You enrich parsed candidate profiles into recruiter-safe JSON." },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
        ENRICHMENT_TIMEOUT_MS,
        `Enrichment model ${provider}:${model}`,
      );

      const raw = completion.choices[0]?.message?.content ?? "{}";
      return normalizeParsedCandidate(extractJsonObject(raw), `${provider}:${model}:enrichment`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[CV Enrich] provider=${provider} model=${model} failed: ${lastError.message}`);
      if (isRetryableProviderError(lastError.message)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  if (lastError) {
    console.warn("[CV Enrich] OpenAI-compatible enrichment failed.", lastError.message);
  }

  return null;
}

async function enrichWithGemini(candidate: ParsedCandidate, sourceText?: string): Promise<ParsedCandidate | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  try {
    const prompt = buildEnrichmentPrompt(candidate, sourceText, {
      includeSourceText: gemini.kind === "vertex" ? VERTEX_INCLUDE_SOURCE_TEXT : true,
      sourceCharLimit: gemini.kind === "vertex" ? Math.min(ENRICHMENT_SOURCE_CHAR_LIMIT, 5000) : ENRICHMENT_SOURCE_CHAR_LIMIT,
    });
    const raw = await withTimeout(
      generateGeminiContent(gemini, {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
      ENRICHMENT_TIMEOUT_MS,
      `${gemini.kind === "vertex" ? "Vertex AI" : "Gemini"} enrichment ${gemini.model}`,
    );

    return normalizeParsedCandidate(extractJsonObject(raw), `${gemini.kind}:${gemini.model}:enrichment`);
  } catch (error) {
    console.warn("[CV Enrich] Gemini enrichment failed.", error);
    return null;
  }
}

async function enrichCandidate(candidate: ParsedCandidate, sourceText?: string): Promise<ParsedCandidate> {
  const deterministic = buildDeterministicEnrichment(candidate);
  const enriched = (await enrichWithOpenAi(deterministic, sourceText)) ?? (await enrichWithGemini(deterministic, sourceText));
  if (!enriched) return deterministic;
  return buildDeterministicEnrichment(mergeParsedCandidates(enriched, deterministic));
}

async function finalizeResponse(
  candidate: ParsedCandidate,
  extraWarnings: string[] = [],
  sourceText?: string,
  extractionDebug: ExtractionDebug = createExtractionDebug(),
): Promise<ParsedCandidate> {
  const mergedWarnings = [...candidate.warnings, ...extraWarnings].filter(Boolean);
  let enriched = buildDeterministicEnrichment(candidate);

  try {
    enriched = await withTimeout(enrichCandidate(candidate, sourceText), ENRICHMENT_TIMEOUT_MS, "Candidate enrichment");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("[CV Parse] Enrichment timed out, returning deterministic briefing.", errorMessage);
    mergedWarnings.push("AI enrichment timed out, so a deterministic recruiter brief was used.");
  }

  const dedupedWarnings = Array.from(new Set(mergedWarnings));
  const normalizedRecord = {
    ...enriched,
    summary: normalizeString(enriched.summary) ?? buildProfessionalSummary(enriched),
    executiveHeadline: normalizeString(enriched.executiveHeadline) ?? buildExecutiveHeadline(enriched),
    professionalSnapshot: normalizeString(enriched.professionalSnapshot) ?? buildProfessionalSnapshot(enriched),
    warnings: dedupedWarnings,
    standardizedProfile: buildStandardizedProfile(enriched),
    extractionMethod: extractionDebug.extractionMethod,
    extractionFallbackUsed: extractionDebug.extractionFallbackUsed,
    extractionFailureClass: extractionDebug.extractionFailureClass,
    sourceTextLength: extractionDebug.sourceTextLength,
    sourceTextTruncated: extractionDebug.sourceTextTruncated,
  };
  const normalized = normalizeParsedCandidate(normalizedRecord, enriched.parseProvider ?? candidate.parseProvider ?? null);
  normalized.parseStatus = deriveStatus(normalized);
  normalized.parseReviewRequired =
    normalized.parseReviewRequired ||
    normalized.parseStatus !== "parsed" ||
    (normalized.parseConfidence ?? 0) < 65;

  const validated = CvParseResponseSchema.safeParse(normalized);
  if (!validated.success) {
    console.warn("[CV Parse] Normalized response validation issues.", validated.error.flatten());
    throw new Error("Normalized CV parse response failed validation");
  }

  return validated.data as ParsedCandidate;
}

async function safeFinalizeResponse(
  candidate: ParsedCandidate,
  extraWarnings: string[] = [],
  sourceText?: string,
  extractionDebug: ExtractionDebug = createExtractionDebug(),
): Promise<ParsedCandidate> {
  try {
    return await finalizeResponse(candidate, extraWarnings, sourceText, extractionDebug);
  } catch (error) {
    console.error("[CV Parse] Final response normalization failed, returning deterministic fallback.", error);
    const fallbackWarnings = Array.from(
      new Set([
        ...candidate.warnings,
        ...extraWarnings,
        "Partial structured output was returned because final normalization hit a server-side issue.",
      ].filter(Boolean)),
    );
    const deterministic = buildDeterministicEnrichment(candidate);
    const sanitizedDeterministic = normalizeParsedCandidate(
      {
        ...deterministic,
        summary: normalizeString(deterministic.summary) ?? buildProfessionalSummary(deterministic),
        executiveHeadline: normalizeString(deterministic.executiveHeadline) ?? buildExecutiveHeadline(deterministic),
        professionalSnapshot: normalizeString(deterministic.professionalSnapshot) ?? buildProfessionalSnapshot(deterministic),
        warnings: fallbackWarnings,
        standardizedProfile: buildStandardizedProfile(deterministic),
        extractionMethod: extractionDebug.extractionMethod,
        extractionFallbackUsed: extractionDebug.extractionFallbackUsed,
        extractionFailureClass: extractionDebug.extractionFailureClass,
        sourceTextLength: extractionDebug.sourceTextLength,
        sourceTextTruncated: extractionDebug.sourceTextTruncated,
        parseReviewRequired: true,
      },
      deterministic.parseProvider,
    );
    sanitizedDeterministic.parseStatus = deriveStatus(sanitizedDeterministic);
    const validated = CvParseResponseSchema.safeParse(sanitizedDeterministic);
    if (validated.success) {
      return validated.data as ParsedCandidate;
    }

    const empty = createEmptyParse(
      candidate.parseProvider,
      "CV parsing returned a partial result that still needs manual review.",
    );
    empty.warnings = fallbackWarnings;
    empty.extractionMethod = extractionDebug.extractionMethod;
    empty.extractionFallbackUsed = extractionDebug.extractionFallbackUsed;
    empty.extractionFailureClass = extractionDebug.extractionFailureClass;
    empty.sourceTextLength = extractionDebug.sourceTextLength;
    empty.sourceTextTruncated = extractionDebug.sourceTextTruncated;
    return empty;
  }
}

router.post("/", requireAuth, requireRole("vendor"), async (req: Request, res: Response) => {
  try {
    const fileName = decodeHeaderFileName(req.headers["x-file-name"]);
    const kind = detectDocumentKind(req.headers["content-type"], fileName);
    const directGeminiAvailable = Boolean(getGeminiClient()) && isGeminiDirectParseEnabled();
    const textProviderAvailable = Boolean(getAiClientConfig());

    if (kind === "json") {
      const bodyValidation = CvParseBodySchema.safeParse(req.body);
      if (!bodyValidation.success) {
        Errors.validation(res, bodyValidation.error.flatten());
        return;
      }

      const preparedSource = buildPrioritizedSourceText(bodyValidation.data.cvText);
      const heuristicCandidate = extractHeuristicCandidate(preparedSource.text);
      const extractionDebug = createExtractionDebug({
        extractionMethod: "json-text",
        extractionFallbackUsed: false,
        extractionFailureClass: null,
        sourceTextLength: preparedSource.sourceTextLength,
        sourceTextTruncated: preparedSource.sourceTextTruncated,
      });
      const inputWarnings = preparedSource.sourceTextTruncated
        ? ["Large resume text was trimmed to keep parsing responsive."]
        : [];
      try {
        if (!directGeminiAvailable) throw new Error("Gemini is not configured.");
        const parsed = await safeFinalizeResponse(
          mergeParsedCandidates(await parseWithGeminiText(preparedSource.text), heuristicCandidate),
          inputWarnings,
          preparedSource.text,
          extractionDebug,
        );
        res.json(parsed);
      } catch (geminiError) {
        console.warn("[CV Parse] Gemini text path failed, using fallback text provider.", geminiError);
        if (textProviderAvailable) {
          res.json(
            await safeFinalizeResponse(
              mergeParsedCandidates(await parseWithOpenAiText(preparedSource.text), heuristicCandidate),
              [...inputWarnings, "A fallback text parser was used for this resume."],
              preparedSource.text,
              extractionDebug,
            ),
          );
          return;
        }
        res.json(
          await safeFinalizeResponse(
            heuristicCandidate,
            [...inputWarnings, "Resume text heuristics were used because AI parsing is unavailable."],
            preparedSource.text,
            extractionDebug,
          ),
        );
      }
      return;
    }

    if (kind === "unsupported" || kind === "text") {
      Errors.badRequest(
        res,
        "Unsupported CV format. Please upload PDF, DOCX, JPG, PNG, WEBP, or send cvText JSON.",
      );
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await readBinaryBody(req, MAX_VERCEL_FILE_BYTES);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("Payload exceeds")) {
        res.status(413).json({
          error: `CV uploads must be ${Math.floor(MAX_VERCEL_FILE_BYTES / 1_000_000)}MB or smaller`,
          code: "BAD_REQUEST",
        });
        return;
      }
      throw err;
    }

    if (!buffer.length) {
      Errors.badRequest(res, "Uploaded document is empty");
      return;
    }

    const warnings: string[] = [];
    let extractionDebug = createExtractionDebug();
    let directDocumentReadFailed = false;

    if (kind === "pdf" || kind === "image") {
      try {
        if (!directGeminiAvailable) throw new Error("Gemini is not configured.");
        const parsed = await parseWithGeminiDocument({
          buffer,
          mimeType: req.headers["content-type"] || (kind === "pdf" ? "application/pdf" : "image/jpeg"),
          fileName,
        });
        res.json(await safeFinalizeResponse(parsed));
        return;
      } catch (geminiError) {
        console.warn("[CV Parse] Gemini document path failed.", geminiError);
        directDocumentReadFailed = true;
      }
    }

    let extractedText = "";
    try {
      if (kind === "pdf") {
        const pdfExtraction = await extractTextFromPdf(buffer);
        extractedText = pdfExtraction.text;
        extractionDebug = pdfExtraction.debug;
      } else if (kind === "image") {
        const imageText = await withTimeout(extractTextFromImageOcr(buffer), OCR_TIMEOUT_MS, "Image OCR extraction");
        const prepared = buildPrioritizedSourceText(imageText);
        extractedText = prepared.text;
        extractionDebug = createExtractionDebug({
          extractionMethod: "ocr",
          extractionFallbackUsed: true,
          extractionFailureClass: null,
          sourceTextLength: prepared.sourceTextLength,
          sourceTextTruncated: prepared.sourceTextTruncated,
        });
      } else if (kind === "docx") {
        const docxExtraction = await extractTextFromDocx(buffer);
        extractedText = docxExtraction.text;
        extractionDebug = docxExtraction.debug;
      }
    } catch (extractError) {
      const message = extractError instanceof Error ? extractError.message : "Unknown extraction error";
      extractionDebug = createExtractionDebug({
        extractionFailureClass:
          (extractError as Error & { failureClass?: ExtractionFailureClass })?.failureClass ?? classifyExtractionError(extractError),
      });
      console.warn("[CV Parse] Text extraction failed.", message);
    }

    if (extractionDebug.extractionFallbackUsed) {
      warnings.push("A resilient document extraction fallback was used for this resume.");
    }
    if (extractionDebug.sourceTextTruncated) {
      warnings.push("Large resume text was trimmed to keep parsing responsive.");
    }

    if (!extractedText) {
      const failureWarnings = directDocumentReadFailed ? ["The server could not read this resume directly."] : [];
      res.json(
        await safeFinalizeResponse(
          createEmptyParse(null, "The document could not be converted into text automatically."),
          [...warnings, ...failureWarnings],
          undefined,
          extractionDebug,
        ),
      );
      return;
    }

    const heuristicCandidate = extractHeuristicCandidate(extractedText);

    try {
      if (!directGeminiAvailable) throw new Error("Gemini is not configured.");
      const parsed = await parseWithGeminiText(extractedText);
      res.json(await safeFinalizeResponse(mergeParsedCandidates(parsed, heuristicCandidate), warnings, extractedText, extractionDebug));
      return;
    } catch (geminiTextError) {
      console.warn("[CV Parse] Gemini text fallback failed.", geminiTextError);
      warnings.push("A fallback text parser was used for this resume.");
    }

    if (textProviderAvailable) {
      const fallback = await parseWithOpenAiText(extractedText);
      res.json(await safeFinalizeResponse(mergeParsedCandidates(fallback, heuristicCandidate), warnings, extractedText, extractionDebug));
      return;
    }

    res.json(
      await safeFinalizeResponse(
        heuristicCandidate,
        [...warnings, "Resume text heuristics were used because no AI provider is configured."],
        extractedText,
        extractionDebug,
      ),
    );
  } catch (err) {
    console.error("CV parse error:", err);
    Errors.internal(res, "CV parsing failed");
  }
});

export default router;
