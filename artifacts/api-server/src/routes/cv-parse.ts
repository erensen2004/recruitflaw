import { Router, Request, Response } from "express";
import OpenAI from "openai";
import mammoth from "mammoth";
import JSZip from "jszip";
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
const ENRICHMENT_MODEL_TIMEOUT_MS = Number(process.env.CV_ENRICHMENT_TIMEOUT_MS || "9000");
const ENRICHMENT_ESCALATION_TIMEOUT_MS = Number(process.env.CV_ENRICHMENT_ESCALATION_TIMEOUT_MS || "12000");
const ENRICHMENT_PIPELINE_TIMEOUT_MS = Number(
  process.env.CV_ENRICHMENT_PIPELINE_TIMEOUT_MS ||
    String(Math.max(18000, ENRICHMENT_MODEL_TIMEOUT_MS + ENRICHMENT_ESCALATION_TIMEOUT_MS + 1500)),
);
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
const DEFAULT_VERTEX_ESCALATION_MODEL =
  process.env.VERTEX_GEMINI_ESCALATION_MODEL || process.env.GEMINI_ESCALATION_MODEL || "gemini-2.5-flash";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || null;
const GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || null;
const VERTEX_INCLUDE_SOURCE_TEXT =
  process.env.CV_VERTEX_ENRICHMENT_INCLUDE_SOURCE_TEXT === "1" ||
  process.env.CV_VERTEX_ENRICHMENT_INCLUDE_SOURCE_TEXT === "true";
const ALLOW_OPENAI_ENRICHMENT_FALLBACK =
  process.env.CV_ALLOW_OPENAI_ENRICHMENT_FALLBACK === "1" ||
  process.env.CV_ALLOW_OPENAI_ENRICHMENT_FALLBACK === "true";

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
  education: ["education", "academic background", "qualifications", "egitim", "öğrenim", "academic history", "training"],
  languages: ["languages", "language", "diller", "dil", "foreign languages", "yabanci dil", "yabancı dil", "yabanci diller", "yabancı diller"],
  summary: ["summary", "profile", "objective", "professional summary", "about", "özet", "profil"],
} as const;

const ALL_SECTION_HEADINGS = Object.values(SECTION_HEADINGS).flat() as string[];
const ALL_SECTION_HEADINGS_NORMALIZED = ALL_SECTION_HEADINGS.map((heading) => normalizeComparableText(heading));

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
  /\b(bachelor|master|degree|diploma|associate|lisans|yüksek lisans|onlisans|önlisans|ön lisans|m\.s\.|b\.s\.|mba|phd|doctorate|ön lisans|sertifika|certificate|bootcamp|bolum|bölüm|department)\b/i;
const INSTITUTION_HINT_REGEX = /\b(university|universite|üniversite|faculty|fakulte|fakülte|institute|school|college|academy|lise|high school|meslek lisesi)\b/i;
const DATE_RANGE_REGEX =
  /(?:(?:0?[1-9]|1[0-2])\s*[./-]\s*)?(?:19|20)\d{2}\s*[-–]\s*(?:present|current|now|devam|halen|ongoing|(?:(?:0?[1-9]|1[0-2])\s*[./-]\s*)?(?:19|20)\d{2})/i;
const LANGUAGE_ALIAS_MAP = {
  English: ["english", "ingilizce", "ingilizce"],
  Turkish: ["turkish", "turkce", "turkce", "turkish native"],
  German: ["german", "almanca"],
  French: ["french", "fransizca", "fransizca"],
  Arabic: ["arabic", "arapca", "arapca"],
  Russian: ["russian", "rusca", "rusca"],
  Spanish: ["spanish", "ispanyolca"],
} as const;
const LANGUAGE_LEVEL_ALIASES: Record<string, string> = {
  native: "Native",
  "ana dil": "Native",
  anadil: "Native",
  fluent: "Fluent",
  professional: "Professional",
  advanced: "Advanced",
  ileri: "Advanced",
  intermediate: "Intermediate",
  orta: "Intermediate",
  basic: "Basic",
  beginner: "Basic",
  temel: "Basic",
  elementary: "Basic",
};

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
      model: DEFAULT_VERTEX_MODEL,
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

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toLowerCase();
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
    if (ALL_SECTION_HEADINGS_NORMALIZED.some((heading) => normalizeComparableText(lowered).includes(heading))) {
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

function stripHeadingPrefix(line: string, headings: readonly string[]): string | null {
  const normalizedLine = line.trim();
  const comparableLine = normalizeComparableText(normalizedLine);

  for (const heading of headings) {
    const comparableHeading = normalizeComparableText(heading);
    if (comparableLine === comparableHeading) {
      return null;
    }
    if (comparableLine.startsWith(`${comparableHeading}:`)) {
      return normalizeString(normalizedLine.slice(heading.length + 1));
    }
    if (comparableLine.startsWith(`${comparableHeading} -`)) {
      return normalizeString(normalizedLine.slice(heading.length + 2));
    }
    if (comparableLine.startsWith(`${comparableHeading} `)) {
      return normalizeString(normalizedLine.slice(heading.length + 1));
    }
  }

  return null;
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

function formatNaturalList(values: string[], conjunction = "ve"): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values.at(-1)}`;
}

function formatExperienceYears(yearsExperience: number | null): string | null {
  if (yearsExperience == null || yearsExperience <= 0) return null;
  return yearsExperience === 1 ? "1 yıl" : `${yearsExperience} yıl`;
}

function sanitizeRecruiterNarrativeText(value: string | null): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  return normalized
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .replace(/\b(?:summary|professional snapshot|executive headline|headline|decision context|strengths|open points)\s*:\s*/gi, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

function hasMalformedRecruiterText(value: string | null | undefined): boolean {
  const normalized = sanitizeRecruiterNarrativeText(value ?? null);
  if (!normalized) return false;

  if (/[�]/.test(normalized)) return true;
  if (/\b(?:[A-Za-zÇĞİÖŞÜçğıöşü]\s+){4,}[A-Za-zÇĞİÖŞÜçğıöşü]\b/.test(normalized)) return true;
  if (/([!?.,:;])\1{1,}/.test(normalized)) return true;
  if (/(?:^|\s)[^A-Za-zÇĞİÖŞÜçğıöşü0-9]{3,}(?:\s|$)/.test(normalized)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  const veryShortWordRatio = words.length
    ? words.filter((word) => word.length === 1 && !/^[A-ZÇĞİÖŞÜ]$/u.test(word)).length / words.length
    : 0;

  return veryShortWordRatio > 0.2;
}

function looksEnglishDominantNarrative(value: string | null | undefined): boolean {
  const normalized = sanitizeRecruiterNarrativeText(value ?? null)?.toLowerCase();
  if (!normalized) return false;

  const englishHits = (
    normalized.match(
      /\b(the|with|and|for|from|experience|experienced|years|based|languages|decision|profile|candidate|focused|skilled|proficient|strong|interest|gained|through|projects|project|development|management|student|ability|specializes|proven|lifecycle|business|analysis)\b/g,
    ) ?? []
  ).length;
  const turkishHits = (
    normalized.match(
      /\b(ve|ile|için|deneyim|deneyimli|aday|profil|lokasyon|dil|ücret|çalışma|bazlı|güçlü|uzmanlık|alanları|karar|bağlamı|tarafında|öne|projelerde|alanında|geliştirdi|yıl)\b/g,
    ) ?? []
  ).length;
  const hasTurkishCharacters = /[çğıöşü]/i.test(normalized);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;

  if (!hasTurkishCharacters && englishHits >= 3 && turkishHits === 0) return true;
  if (englishHits >= 4 && englishHits >= turkishHits * 2 && tokenCount >= 12) return true;

  return englishHits >= 3 && englishHits > turkishHits + 1;
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
  const explicitItems = deriveLanguageItems(candidate)
    .map((item) => {
      if (!item.name) return null;
      return item.level ? `${item.name} (${item.level})` : item.name;
    })
    .filter((item): item is string => Boolean(item));

  return dedupeList([...explicitItems, ...splitLooseList(candidate.languages)]).slice(0, 3);
}

function buildDecisionContext(candidate: ParsedCandidate): string[] {
  const parts = dedupeList([
    candidate.location ? `${candidate.location} bazlı` : null,
    deriveLanguageItems(candidate).length
      ? `Dil tarafında ${formatNaturalList(
          deriveLanguageItems(candidate)
            .map((item) => (item.level ? `${item.name} (${item.level})` : item.name))
            .filter(Boolean) as string[],
          "ve",
        )}`
      : null,
    candidate.inferredWorkModel ?? inferWorkModel(candidate),
    candidate.expectedSalary != null ? inferSalarySignal(candidate) : null,
  ].filter((value): value is string => Boolean(value)));

  return parts.slice(0, 3);
}

function splitRecruiterSentences(value?: string | null): string[] {
  return (value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeString(sentence))
    .filter((sentence): sentence is string => Boolean(sentence))
    .map((sentence) => /[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
}

function dedupeRecruiterSentences(sentences: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const sentence of sentences) {
    const comparable = normalizeComparableText(sentence);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    result.push(sentence);
  }

  return result;
}

function sanitizeRecruiterSummary(candidate: ParsedCandidate, fallback: string | null): string | null {
  const candidateSummary = looksEnglishDominantNarrative(candidate.summary)
    ? null
    : sanitizeRecruiterNarrativeText(candidate.summary);
  const sentences = dedupeRecruiterSentences([
    ...splitRecruiterSentences(candidateSummary),
    ...splitRecruiterSentences(sanitizeRecruiterNarrativeText(fallback)),
  ]);

  if (!sentences.length) return null;

  const decisionContext = buildDecisionContext(candidate);
  const hasDecisionContext = sentences.some((sentence) =>
    /istanbul|ankara|izmir|uzaktan|hibrit|ofis|maaş|ücret|dil|ingilizce|lokasyon|çalışma modeli/i.test(sentence),
  );

  if (!hasDecisionContext && decisionContext.length) {
    sentences.push(`Karar bağlamı: ${decisionContext.join("; ")}.`);
  }

  return dedupeRecruiterSentences(sentences).slice(0, 4).join(" ");
}

function sanitizeProfessionalSnapshot(candidate: ParsedCandidate, fallback: string | null): string | null {
  const summarySentences = new Set(splitRecruiterSentences(candidate.summary).map((sentence) => normalizeComparableText(sentence)));
  const snapshotSentences = dedupeRecruiterSentences([
    ...splitRecruiterSentences(looksEnglishDominantNarrative(candidate.professionalSnapshot) ? null : candidate.professionalSnapshot),
    ...splitRecruiterSentences(sanitizeRecruiterNarrativeText(fallback)),
  ]).filter((sentence) => !summarySentences.has(normalizeComparableText(sentence)));

  if (!snapshotSentences.length) {
    const rebuilt = splitRecruiterSentences(buildProfessionalSnapshot(candidate));
    return dedupeRecruiterSentences(rebuilt).slice(0, 5).join(" ");
  }

  return snapshotSentences.slice(0, 5).join(" ");
}

function buildProfessionalSummary(candidate: ParsedCandidate): string | null {
  const title = getPrimaryTitle(candidate);
  const years = formatExperienceYears(candidate.yearsExperience);
  const location = normalizeString(candidate.location);
  const skills = getSummarySkills(candidate);
  const domainFocus = deriveDomainFocus(candidate);
  const languages = getLanguagesSummary(candidate);
  const highlights = getExperienceHighlights(candidate);
  const achievements = deriveNotableAchievements(candidate);
  const decisionContext = buildDecisionContext(candidate);
  const existingSummary = normalizeString(candidate.summary);
  const experienceSignals = dedupeList(
    candidate.parsedExperience.flatMap((item) =>
      [item.title, item.company]
        .map((value) => normalizeString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 2);
  const sentences: string[] = [];

  if (title) {
    const intro = [title, years ? `${years} deneyimle` : null, location ? `${location} bazlı` : null]
      .filter(Boolean)
      .join(" ");
    sentences.push(`${intro}.`);
  } else if (years && location) {
    sentences.push(`${location} bazlı, ${years} deneyimli aday profili.`);
  } else if (years) {
    sentences.push(`${years} deneyime sahip aday profili.`);
  } else if (location) {
    sentences.push(`Aday ${location} bazlı görünüyor.`);
  }

  const focusSignals = dedupeList([...domainFocus, ...skills]).slice(0, 4);
  if (focusSignals.length) {
    sentences.push(`Ana uzmanlık alanları ${formatNaturalList(focusSignals, "ve")} etrafında şekilleniyor.`);
  } else if (experienceSignals.length) {
    sentences.push(`En güçlü deneyim sinyali ${formatNaturalList(experienceSignals, "ve")} tarafında görünüyor.`);
  }

  const proofSignals = dedupeList([...achievements, ...highlights, ...experienceSignals]).slice(0, 2);
  if (proofSignals.length) {
    sentences.push(`En güçlü kanıt ${formatNaturalList(proofSignals, "ve")} üzerinden geliyor.`);
  }

  if (decisionContext.length) {
    sentences.push(`Karar bağlamı: ${decisionContext.join("; ")}.`);
  } else if (languages.length) {
    sentences.push(`Dil yetkinliği tarafında ${formatNaturalList(languages, "ve")} öne çıkıyor.`);
  }

  if (!sentences.length) {
    return existingSummary;
  }

  return sanitizeRecruiterSummary(candidate, sentences.slice(0, 4).join(" "));
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
    if (ALL_SECTION_HEADINGS_NORMALIZED.includes(normalized)) continue;
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
  const comparable = normalizeComparableText(text);
  const matches = Object.entries(LANGUAGE_ALIAS_MAP)
    .filter(([, aliases]) => aliases.some((alias) => comparable.includes(normalizeComparableText(alias))))
    .map(([language]) => language);
  return matches.length ? Array.from(new Set(matches)).join(", ") : null;
}

function extractEducationFromBody(lines: string[]): string | null {
  const educationKeywords =
    /\b(university|college|institute|school|bachelor|master|degree|diploma|lise|üniversite|faculty|fakülte|department|bolum|bölüm|gpa|cgpa|high school|meslek lisesi)\b/i;
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
    headline ? `Başlık: ${headline}` : null,
    contact ? `İletişim: ${contact}` : null,
    location ? `Lokasyon: ${location}` : null,
    experience ? `Deneyim: ${experience}` : null,
    skills ? `Yetenekler: ${skills}` : null,
    education ? `Eğitim: ${education}` : null,
    languages ? `Diller: ${languages}` : null,
  ].filter(Boolean);
  return sections.length ? sections.join("\n") : null;
}

function looksCurrentValue(value?: string | null) {
  return Boolean(value && /\b(current|present|now|ongoing)\b/i.test(value));
}

function inferSenioritySignal(candidate: ParsedCandidate): string | null {
  const title = (candidate.currentTitle || candidate.parsedExperience[0]?.title || "").toLowerCase();
  const years = candidate.yearsExperience ?? 0;

  if (/\b(principal|staff|head|director)\b/.test(title)) return "Principal seviye profil";
  if (/\b(lead|manager)\b/.test(title)) return "Lead seviye profil";
  if (/\b(senior|sr)\b/.test(title) || years >= 8) return "Senior seviye profil";
  if (years >= 5) return "Mid-senior seviye profil";
  if (years >= 3) return "Mid seviye profil";
  if (years > 0) return "Erken kariyer profili";
  return title ? "Kıdem seviyesi mevcut unvandan türetildi" : null;
}

function inferWorkModel(candidate: ParsedCandidate): string | null {
  const text = [candidate.location, candidate.summary, candidate.standardizedProfile].filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (/\bremote\b/.test(text)) return "Uzaktan çalışmaya açık";
  if (/\bhybrid\b/.test(text)) return "Hibrit çalışmaya açık";
  if (/\boffice|on-site|onsite\b/.test(text)) return "Ofis odaklı";
  return null;
}

function inferLocationFlexibility(candidate: ParsedCandidate): string | null {
  const workModel = inferWorkModel(candidate);
  if (candidate.location && workModel) return `${candidate.location} • ${workModel}`;
  if (candidate.location) return `${candidate.location} bazlı`;
  return workModel;
}

function inferSalarySignal(candidate: ParsedCandidate): string | null {
  if (candidate.expectedSalary != null) {
    return `Ücret beklentisi ${Math.round(candidate.expectedSalary).toLocaleString("tr-TR")} TL seviyesinde görünüyor`;
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
  const seedItems = normalizeLanguageItems(candidate.languageItems);
  const seeds = seedItems
    .map((item) => ({
      name: normalizeString(item.name),
      level: normalizeString(item.level),
      confidence: item.confidence ?? 82,
      source: item.source ?? "model",
    }))
    .filter((item) => item.name);

  const rawParts = dedupeList(
    [candidate.languages ?? null, ...seedItems.map((item) => item.name)]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .flatMap((value) =>
        value
          .split(/,|\/|\||•|·|;|\n/)
          .map((item) => normalizeString(item))
          .filter((item): item is string => Boolean(item)),
      ),
  );

  const parsed = rawParts
    .map((entry) => {
      const comparable = normalizeComparableText(entry);
      const matchedLanguage = Object.entries(LANGUAGE_ALIAS_MAP).find(([, aliases]) =>
        aliases.some((alias) => comparable.includes(normalizeComparableText(alias))),
      )?.[0] ?? normalizeString(entry);
      const levelMatch = comparable.match(/\b(a1|a2|b1|b2|c1|c2|native|fluent|professional|advanced|intermediate|basic|beginner|elementary|ana dil|anadil|ileri|orta|temel)\b/i);
      const normalizedLevel = levelMatch ? LANGUAGE_LEVEL_ALIASES[levelMatch[1]!.toLowerCase()] ?? levelMatch[1]!.toUpperCase() : null;

      return {
        name: matchedLanguage,
        level: normalizedLevel,
        confidence: normalizedLevel ? 86 : 72,
        source: "parsed-text",
      };
    })
    .filter((item) => item.name);

  const merged = [...seeds, ...parsed];
  const seen = new Set<string>();
  const result: ParsedLanguageItem[] = [];

  for (const item of merged) {
    const name = normalizeString(item.name);
    if (!name) continue;
    const key = normalizeComparableText(name);
    if (seen.has(key)) {
      const existing = result.find((entry) => normalizeComparableText(entry.name || "") === key);
      if (existing && !existing.level && item.level) {
        existing.level = item.level;
        existing.confidence = Math.max(existing.confidence ?? 0, item.confidence ?? 0);
      }
      continue;
    }
    seen.add(key);
    result.push({
      name,
      level: normalizeString(item.level),
      confidence: item.confidence ?? 72,
      source: item.source ?? "parsed-text",
    });
  }

  return result;
}

function buildFieldConfidence(candidate: ParsedCandidate): ParsedFieldConfidence {
  const contactSignals = [candidate.email, candidate.phone].filter(Boolean).length;
  const experienceSignals = candidate.parsedExperience.length;
  const experienceRichSignals = candidate.parsedExperience.filter(
    (item) => (item.highlights?.length ?? 0) > 0 || item.scope || (item.techStack?.length ?? 0) > 0,
  ).length;
  const educationSignals = candidate.parsedEducation.length;
  const languageSignals = deriveLanguageItems(candidate).length;
  const summarySignals = [
    normalizeString(candidate.summary),
    normalizeString(candidate.executiveHeadline),
    normalizeString(candidate.professionalSnapshot),
  ].filter(Boolean).length;
  return {
    contact:
      contactSignals === 2
        ? 96
        : contactSignals === 1
          ? 62
          : 12,
    experience: Math.min(98, 28 + experienceSignals * 18 + experienceRichSignals * 10),
    education:
      educationSignals > 0
        ? Math.min(94, 30 + educationSignals * 18)
        : candidate.education
          ? 42
          : 10,
    languages:
      languageSignals > 0
        ? Math.min(92, 34 + languageSignals * 16)
        : candidate.languages
          ? 40
          : 12,
    compensation: candidate.expectedSalary != null ? 78 : 18,
    summary: Math.min(94, 24 + summarySignals * 24 + (candidate.standardizedProfile ? 10 : 0)),
  };
}

function computeParseConfidence(candidate: ParsedCandidate): number {
  const fieldConfidence = candidate.fieldConfidence ?? buildFieldConfidence(candidate);
  const weightedTotal =
    (fieldConfidence.contact ?? 0) * 0.22 +
    (fieldConfidence.experience ?? 0) * 0.28 +
    (fieldConfidence.education ?? 0) * 0.12 +
    (fieldConfidence.languages ?? 0) * 0.08 +
    (fieldConfidence.compensation ?? 0) * 0.05 +
    (fieldConfidence.summary ?? 0) * 0.25;
  return Math.max(8, Math.min(98, Math.round(weightedTotal)));
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
    years ? `${years} deneyimle` : null,
    focus.length ? `${formatNaturalList(focus.slice(0, 3), "ve")} odağıyla` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" ") : null;
}

function buildProfessionalSnapshot(candidate: ParsedCandidate): string | null {
  const title = getPrimaryTitle(candidate);
  const years = formatExperienceYears(candidate.yearsExperience);
  const focus = deriveDomainFocus(candidate);
  const languages = deriveLanguageItems(candidate).map((item) => item.level ? `${item.name} (${item.level})` : item.name).filter(Boolean) as string[];
  const achievements = deriveNotableAchievements(candidate);
  const employers = dedupeList(
    candidate.parsedExperience
      .map((item) => normalizeString(item.company))
      .filter((item): item is string => Boolean(item)),
  ).slice(0, 2);
  const strongestStack = getSummarySkills(candidate).slice(0, 4);
  const decisionContext = buildDecisionContext(candidate);
  const sentences: string[] = [];

  if (title) {
    const intro = [
      title,
      years ? `${years} deneyimle` : null,
      candidate.location ? `${candidate.location} bazlı` : null,
    ]
      .filter(Boolean)
      .join(" ");
    sentences.push(`${intro}.`);
  }

  if (focus.length) {
    sentences.push(`Profilin en güçlü yönü ${formatNaturalList(focus.slice(0, 4), "ve")} çevresinde toplanıyor.`);
  }

  if (strongestStack.length) {
    sentences.push(`Teknik ve teslimat sinyalleri en çok ${formatNaturalList(strongestStack, "ve")} tarafında güçleniyor.`);
  }

  if (achievements.length) {
    sentences.push(`Son dönemdeki işi en iyi ${formatNaturalList(achievements.slice(0, 2), "ve")} üzerinden okunuyor.`);
  } else if (employers.length) {
    sentences.push(`Yakın dönem şirket deneyimi ${formatNaturalList(employers, "ve")} çevresinde görülüyor.`);
  }

  if (decisionContext.length) {
    sentences.push(`Karar bağlamında ${decisionContext.join("; ")} öne çıkıyor.`);
  } else if (languages.length) {
    sentences.push(`Dil tarafında ${formatNaturalList(languages, "ve")} sinyali bulunuyor.`);
  }

  return sentences.length ? sentences.slice(0, 5).join(" ") : buildProfessionalSummary(candidate);
}

function mergeEvidenceBackedLists(primary: string[], fallback: string[], limit = 6): string[] {
  return dedupeList([...primary, ...fallback]).slice(0, limit);
}

function buildDeterministicEnrichment(candidate: ParsedCandidate): ParsedCandidate {
  const enrichedExperience = enrichExperienceItems(candidate);
  const enrichedEducation = enrichEducationItems(candidate);
  const languageItems = deriveLanguageItems(candidate);
  const derivedLanguages = dedupeList(
    languageItems.map((item) => item.level ? `${item.name} (${item.level})` : item.name).filter((item): item is string => Boolean(item)),
  ).join(", ");
  const domainFocus = mergeEvidenceBackedLists(candidate.domainFocus, deriveDomainFocus(candidate));
  const notableAchievements = mergeEvidenceBackedLists(
    candidate.notableAchievements,
    deriveNotableAchievements({ ...candidate, parsedExperience: enrichedExperience }),
  );
  const fieldConfidence = buildFieldConfidence({ ...candidate, parsedExperience: enrichedExperience, parsedEducation: enrichedEducation, languageItems } as ParsedCandidate);
  const candidateStrengths = mergeEvidenceBackedLists(
    candidate.candidateStrengths,
    [
      getPrimaryTitle(candidate),
      candidate.yearsExperience != null ? `${candidate.yearsExperience} years of experience` : null,
      ...domainFocus,
      ...notableAchievements,
      languageItems.length
        ? `Diller: ${formatNaturalList(
            languageItems
              .map((item) => (item.level ? `${item.name} (${item.level})` : item.name))
              .filter(Boolean) as string[],
            "ve",
          )}`
        : null,
    ].filter((value): value is string => Boolean(value)),
  );

  const candidateRisks = mergeEvidenceBackedLists(
    candidate.candidateRisks,
    [
      !candidate.phone ? "Telefon numarası eksik" : null,
      candidate.expectedSalary == null ? "Ücret beklentisi net değil" : null,
      !enrichedExperience.length ? "Deneyim akışı zayıf görünüyor" : null,
      !enrichedEducation.length ? "Eğitim bilgisi ince kalmış" : null,
      !languageItems.length ? "Dil yetkinliği net değil" : null,
      candidate.parseReviewRequired ? "Bazı profil detaylarının doğrulanması gerekiyor" : null,
      (candidate.parseConfidence ?? 0) < 70 ? `Parse güveni ${candidate.parseConfidence ?? 0}% seviyesinde` : null,
    ].filter((value): value is string => Boolean(value)),
  );

  const evidence = mergeEvidenceBackedLists(
    candidate.evidence,
    [
      getPrimaryTitle(candidate) ? `Unvan sinyali: ${getPrimaryTitle(candidate)}` : null,
      candidate.location ? `Lokasyon sinyali: ${candidate.location}` : null,
      domainFocus.length ? `Alan sinyali: ${formatNaturalList(domainFocus.slice(0, 3), "ve")}` : null,
      enrichedExperience[0]?.company ? `Şirket sinyali: ${enrichedExperience[0].company}` : null,
      notableAchievements[0] ? `Başarı sinyali: ${notableAchievements[0]}` : null,
    ].filter((value): value is string => Boolean(value)),
  );

  const enrichedCandidate: ParsedCandidate = {
    ...candidate,
    parsedExperience: enrichedExperience,
    parsedEducation: enrichedEducation,
    education: candidate.education ?? getEducationSummary({ ...candidate, parsedEducation: enrichedEducation } as ParsedCandidate),
    languages: candidate.languages ?? (derivedLanguages || null),
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

  enrichedCandidate.parseConfidence = computeParseConfidence(enrichedCandidate);
  return enrichedCandidate;
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
  return normalizeComparableText(line).replace(/[:\-\u2022]/g, " ").replace(/\s+/g, " ").trim();
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
    return headings.some((heading) => {
      const normalizedHeading = normalizeComparableText(heading);
      return normalized === normalizedHeading || normalized.startsWith(`${normalizedHeading} `);
    });
  });
  if (startIndex === -1) return [];

  const collected: string[] = [];
  const inlineContent = stripHeadingPrefix(lines[startIndex] ?? "", headings);
  if (inlineContent) {
    collected.push(inlineContent);
    if (collected.length >= maxLines) {
      return collected;
    }
  }
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeHeading(line);
    const isAnotherHeading = ALL_SECTION_HEADINGS_NORMALIZED.some(
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
  if (!candidate.email && !candidate.phone) {
    candidate.warnings.push("Resume does not clearly expose contact details in the extracted text.");
  }
  if (!candidate.parsedEducation.length && !candidate.education) {
    candidate.warnings.push("Education details are not clearly present in the extracted text.");
  }
  candidate.fieldConfidence = buildFieldConfidence(candidate);
  candidate.parseConfidence = computeParseConfidence(candidate);
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
    parseConfidence: primary.parseConfidence ?? fallback.parseConfidence ?? 0,
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

  merged.fieldConfidence = merged.fieldConfidence ?? buildFieldConfidence(merged);
  merged.parseConfidence = computeParseConfidence(merged);

  return merged;
}

function normalizeParsedCandidate(parsed: Record<string, unknown>, provider: string | null): ParsedCandidate {
  const parsedSkills = normalizeStringList(parsed.parsedSkills ?? parsed.skills);
  const parsedExperience = normalizeExperience(parsed.parsedExperience ?? parsed.experience);
  const parsedEducation = normalizeEducation(parsed.parsedEducation ?? parsed.educationItems);
  const languageItems = normalizeLanguageItems(parsed.languageItems);
  const normalizedLanguages =
    normalizeString(parsed.languages) ??
    (languageItems.length
      ? dedupeList(
          languageItems
            .map((item) => item.level ? `${item.name} (${item.level})` : item.name)
            .filter((item): item is string => Boolean(item)),
        ).join(", ")
      : null);
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
    languages: normalizedLanguages,
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
    candidate.fieldConfidence = candidate.fieldConfidence ?? buildFieldConfidence(candidate);
    candidate.parseConfidence = computeParseConfidence(candidate);
  }

  candidate.fieldConfidence = candidate.fieldConfidence ?? buildFieldConfidence(candidate);

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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTextFromDocxXml(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

async function extractSupplementalTextFromDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlEntries = Object.keys(zip.files)
    .filter((name) =>
      /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name),
    )
    .sort((left, right) => left.localeCompare(right));

  const contents = await Promise.all(
    xmlEntries.map(async (name) => {
      const file = zip.file(name);
      if (!file) return "";
      return extractTextFromDocxXml(await file.async("string"));
    }),
  );

  return normalizeExtractedText(contents.join("\n"));
}

async function extractTextFromDocx(buffer: Buffer): Promise<{ text: string; debug: ExtractionDebug }> {
  const [mammothResult, supplementalText] = await withTimeout(
    Promise.all([
      mammoth.extractRawText({ buffer }),
      extractSupplementalTextFromDocx(buffer).catch(() => ""),
    ]),
    DOCX_EXTRACTION_TIMEOUT_MS,
    "DOCX extraction",
  );
  const text = normalizeExtractedText([mammothResult.value, supplementalText].filter(Boolean).join("\n"));
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
    candidateStrengths: candidate.candidateStrengths.slice(0, 5),
    candidateRisks: candidate.candidateRisks.slice(0, 5),
    notableAchievements: candidate.notableAchievements.slice(0, 5),
    evidence: candidate.evidence.slice(0, 6),
    parsedExperience: candidate.parsedExperience.slice(0, 6).map((item) => ({
      ...item,
      techStack: item.techStack?.slice(0, 8) ?? [],
      highlights: item.highlights?.slice(0, 3) ?? [],
      impactHighlights: item.impactHighlights?.slice(0, 3) ?? [],
    })),
    parsedEducation: candidate.parsedEducation.slice(0, 4),
    parsedSkills: candidate.parsedSkills.slice(0, 14),
    languageItems: candidate.languageItems.slice(0, 6),
    extractionMethod: undefined,
    extractionFallbackUsed: undefined,
    extractionFailureClass: undefined,
    sourceTextLength: undefined,
    sourceTextTruncated: undefined,
  };
  return [
    "Yapılandırılmış aday profilini recruiter kullanımı için Türkçe bir executive brief'e dönüştürüyorsun.",
    "Yalnızca structured JSON ve varsa kısa CV metni içindeki kanıtları kullan. İşveren, tarih, proje, teknoloji, eğitim veya kıdem uydurma.",
    "Return exactly one JSON object and nothing else.",
    "Çıktı dili doğal, akıcı ve düzgün Türkçe recruiter dili olsun. Teknik terimler gerektiğinde İngilizce kalabilir.",
    "Kısa ama güçlü, somut ve recruiter-friendly yaz. Aynı cümleyi veya aynı kalıbı tekrar etme.",
    "If a field is weak or unsupported, return null or an empty array.",
    "summary 3-4 cümlelik hızlı recruiter özeti olsun.",
    "summary sırası şu olsun: aday kimdir, ana uzmanlık alanı nedir, en güçlü deneyim/stack/domain kanıtı nedir, karar için önemli bağlam nedir.",
    "executiveHeadline tek satırlık kısa bir başlık olsun; paragraf yazma.",
    "professionalSnapshot summary'den daha detaylı, daha premium ve daha ikna edici olsun.",
    "professionalSnapshot ile summary aynı cümleleri veya aynı ifadeleri tekrar etmesin.",
    "candidateStrengths kısa, somut ve kanıt temelli maddeler olsun.",
    "candidateRisks açık riskten çok recruiter open point mantığında, profesyonel ve kontrollü yazılsın.",
    "notableAchievements yalnızca kaynakta desteklenen somut iş/çıktı sinyallerinden oluşsun.",
    "domainFocus rol alanını tarif eden 2-5 kısa odak ifadesi olsun.",
    "standardizedProfile sadece iç fallback alanı; satış metni değil, kompakt normalize metin olarak tut.",
    "parsedExperience may be enriched with scope, techStack, impactHighlights, current, and seniorityContribution only when supported.",
    preparedSource
      ? "If parsedExperience has fewer than 2 entries but the source text clearly contains multiple role/date blocks, rebuild parsedExperience from that evidence."
      : "If source text is omitted, keep parsedExperience conservative and do not infer missing role history.",
    "parsedEducation may be enriched with confidence only when support exists.",
    preparedSource
      ? "If parsedEducation is too thin but the source text clearly contains multiple education signals, rebuild parsedEducation from that evidence."
      : "If source text is omitted, keep parsedEducation conservative and do not infer extra schools or degrees.",
    "languageItems should include name, level, confidence, and source.",
    "fieldConfidence should include contact, experience, education, languages, compensation, summary as 0-100 integers.",
    "Bozuk Türkçe, kırık token, yarım kelime veya anlamsız tekrar üretme.",
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

function createGeminiClientWithModel(gemini: GeminiClient, model: string): GeminiClient {
  return { ...gemini, model };
}

function isRichExperienceItem(item: ParsedExperienceItem): boolean {
  return Boolean(
    (item.highlights && item.highlights.length) ||
      (item.impactHighlights && item.impactHighlights.length) ||
      (item.techStack && item.techStack.length) ||
      item.scope ||
      item.seniorityContribution,
  );
}

function hasGenericRecruiterBriefLanguage(value: string | null | undefined): boolean {
  if (!value) return false;
  return /the profile is most credible around|the strongest work signals point to|some profile details still need confirmation|profilin en güçlü yönü|teknik ve teslimat sinyalleri|karar bağlamında/i.test(
    value,
  );
}

function hasGenericSummaryLanguage(value: string | null | undefined): boolean {
  if (!value) return false;
  return /core strengths are concentrated around|strongest evidence comes from|decision context:|ana uzmanlık alanları|en güçlü kanıt|karar bağlamı:/i.test(
    value,
  );
}

function hasSummarySnapshotOverlap(summary: string | null | undefined, snapshot: string | null | undefined): boolean {
  const summarySentences = splitRecruiterSentences(summary)
    .map((sentence) => normalizeComparableText(sentence))
    .filter(Boolean);
  const snapshotSentences = splitRecruiterSentences(snapshot)
    .map((sentence) => normalizeComparableText(sentence))
    .filter(Boolean);

  if (!summarySentences.length || !snapshotSentences.length) return false;

  const overlapCount = summarySentences.filter((sentence) => snapshotSentences.includes(sentence)).length;
  return overlapCount >= Math.min(2, summarySentences.length);
}

function getWeakEnrichmentSignals(candidate: ParsedCandidate): string[] {
  const signals: string[] = [];
  if (candidate.parseStatus !== "parsed") signals.push("status");
  if (candidate.parseReviewRequired) signals.push("review");
  if ((candidate.parseConfidence ?? 0) < 70) signals.push("confidence");
  if (!candidate.executiveHeadline || candidate.executiveHeadline.length < 18) signals.push("headline");
  if (hasMalformedRecruiterText(candidate.executiveHeadline)) signals.push("broken-headline");
  if (!candidate.professionalSnapshot || candidate.professionalSnapshot.length < 140) signals.push("snapshot");
  if (hasGenericRecruiterBriefLanguage(candidate.professionalSnapshot)) signals.push("generic-snapshot");
  if (hasMalformedRecruiterText(candidate.professionalSnapshot)) signals.push("broken-snapshot");
  if (looksEnglishDominantNarrative(candidate.professionalSnapshot)) signals.push("english-snapshot");
  if (!candidate.summary || candidate.summary.length < 160) signals.push("summary");
  if (hasGenericSummaryLanguage(candidate.summary)) signals.push("generic-summary");
  if (hasMalformedRecruiterText(candidate.summary)) signals.push("broken-summary");
  if (looksEnglishDominantNarrative(candidate.summary)) signals.push("english-summary");
  if (candidate.candidateStrengths.length < 3) signals.push("strengths");
  if (candidate.notableAchievements.length < 2) signals.push("achievements");
  if (!candidate.parsedExperience.length || candidate.parsedExperience.every((item) => !isRichExperienceItem(item))) {
    signals.push("experience");
  }
  return signals;
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
        ENRICHMENT_MODEL_TIMEOUT_MS,
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

  const runEnrichment = async (
    targetClient: GeminiClient,
    options?: { includeSourceText?: boolean; sourceCharLimit?: number; timeoutMs?: number },
  ): Promise<ParsedCandidate | null> => {
    const prompt = buildEnrichmentPrompt(candidate, sourceText, {
      includeSourceText: options?.includeSourceText ?? (targetClient.kind === "vertex" ? VERTEX_INCLUDE_SOURCE_TEXT : true),
      sourceCharLimit:
        options?.sourceCharLimit ??
        (targetClient.kind === "vertex" ? Math.min(ENRICHMENT_SOURCE_CHAR_LIMIT, 5000) : ENRICHMENT_SOURCE_CHAR_LIMIT),
    });
    const raw = await withTimeout(
      generateGeminiContent(targetClient, {
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
      options?.timeoutMs ?? ENRICHMENT_MODEL_TIMEOUT_MS,
      `${targetClient.kind === "vertex" ? "Vertex AI" : "Gemini"} enrichment ${targetClient.model}`,
    );

    return normalizeParsedCandidate(extractJsonObject(raw), `${targetClient.kind}:${targetClient.model}:enrichment`);
  };

  try {
    const primary = await runEnrichment(gemini);
    if (!primary) return null;

    const weakSignals = getWeakEnrichmentSignals(primary);
    const structuralSignals = weakSignals.filter((signal) =>
      ["status", "review", "confidence", "headline", "strengths", "achievements", "experience"].includes(signal),
    );
    const severeCopySignals = weakSignals.filter((signal) =>
      ["snapshot", "generic-snapshot", "summary", "generic-summary", "english-snapshot", "english-summary"].includes(signal),
    );
    const shouldEscalate =
      (structuralSignals.length > 0 || severeCopySignals.length >= 3 || hasSummarySnapshotOverlap(primary.summary, primary.professionalSnapshot)) &&
      /flash-lite/i.test(gemini.model) &&
      gemini.model !== DEFAULT_VERTEX_ESCALATION_MODEL;

    if (!shouldEscalate) {
      return primary;
    }

    console.warn(
      `[CV Enrich] Escalating Gemini enrichment from ${gemini.model} to ${DEFAULT_VERTEX_ESCALATION_MODEL} due to weak signals: ${weakSignals.join(", ")}`,
    );

    const escalated = await runEnrichment(createGeminiClientWithModel(gemini, DEFAULT_VERTEX_ESCALATION_MODEL), {
      includeSourceText: Boolean(sourceText),
      sourceCharLimit: Math.min(ENRICHMENT_SOURCE_CHAR_LIMIT, 8000),
      timeoutMs: ENRICHMENT_ESCALATION_TIMEOUT_MS,
    });

    return escalated ?? primary;
  } catch (error) {
    console.warn("[CV Enrich] Gemini enrichment failed.", error);
    return null;
  }
}

async function enrichCandidate(candidate: ParsedCandidate, sourceText?: string): Promise<ParsedCandidate> {
  const deterministic = buildDeterministicEnrichment(candidate);
  const geminiConfigured = Boolean(getGeminiClient());
  const enriched =
    (await enrichWithGemini(deterministic, sourceText)) ??
    ((!geminiConfigured || ALLOW_OPENAI_ENRICHMENT_FALLBACK)
      ? await enrichWithOpenAi(deterministic, sourceText)
      : null);
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
    enriched = await withTimeout(enrichCandidate(candidate, sourceText), ENRICHMENT_PIPELINE_TIMEOUT_MS, "Candidate enrichment");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("[CV Parse] Enrichment timed out, returning deterministic briefing.", errorMessage);
    mergedWarnings.push("AI enrichment timed out, so a deterministic recruiter brief was used.");
  }

  const dedupedWarnings = Array.from(new Set(mergedWarnings));
  const finalLanguageItems = enriched.languageItems.length ? enriched.languageItems : deriveLanguageItems(enriched);
  const finalLanguages =
    normalizeString(enriched.languages) ??
    (finalLanguageItems.length
      ? dedupeList(
          finalLanguageItems
            .map((item) => item.level ? `${item.name} (${item.level})` : item.name)
            .filter((item): item is string => Boolean(item)),
        ).join(", ")
      : null);
  const normalizedRecord = {
    ...enriched,
    languages: finalLanguages,
    languageItems: finalLanguageItems,
    summary: sanitizeRecruiterSummary(enriched, buildProfessionalSummary(enriched)),
    executiveHeadline: normalizeString(enriched.executiveHeadline) ?? buildExecutiveHeadline(enriched),
    professionalSnapshot: sanitizeProfessionalSnapshot(enriched, buildProfessionalSnapshot(enriched)),
    warnings: dedupedWarnings,
    standardizedProfile: sanitizeStandardizedProfile(normalizeString(enriched.standardizedProfile)) ?? buildStandardizedProfile(enriched),
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
    const deterministicLanguageItems = deterministic.languageItems.length ? deterministic.languageItems : deriveLanguageItems(deterministic);
    const sanitizedDeterministic = normalizeParsedCandidate(
      {
        ...deterministic,
        languages:
          normalizeString(deterministic.languages) ??
          (deterministicLanguageItems.length
            ? dedupeList(
                deterministicLanguageItems
                  .map((item) => item.level ? `${item.name} (${item.level})` : item.name)
                  .filter((item): item is string => Boolean(item)),
              ).join(", ")
            : null),
        languageItems: deterministicLanguageItems,
        summary: normalizeString(deterministic.summary) ?? buildProfessionalSummary(deterministic),
        executiveHeadline: normalizeString(deterministic.executiveHeadline) ?? buildExecutiveHeadline(deterministic),
        professionalSnapshot: normalizeString(deterministic.professionalSnapshot) ?? buildProfessionalSnapshot(deterministic),
        warnings: fallbackWarnings,
        standardizedProfile:
          sanitizeStandardizedProfile(normalizeString(deterministic.standardizedProfile)) ?? buildStandardizedProfile(deterministic),
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
