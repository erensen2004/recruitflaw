import { Router, Request, Response } from "express";
import OpenAI from "openai";
import mammoth from "mammoth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { CvParseBodySchema, CvParseResponseSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();
const MAX_VERCEL_FILE_BYTES = Number(process.env.MAX_CV_PARSE_BYTES || "4000000");

const DEFAULT_OPENROUTER_MODELS = [
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-1.2b-instruct:free",
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
};

type ParsedEducationItem = {
  institution: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
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
  parsedSkills: string[];
  parsedExperience: ParsedExperienceItem[];
  parsedEducation: ParsedEducationItem[];
  parseConfidence: number | null;
  parseReviewRequired: boolean;
  parseStatus: "not_started" | "processing" | "parsed" | "partial" | "failed";
  parseProvider: string | null;
  warnings: string[];
};

type DocumentKind = "pdf" | "docx" | "image" | "text" | "json" | "unsupported";

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

function getGeminiClient():
  | {
      genAI: GoogleGenerativeAI;
      model: string;
    }
  | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  return {
    genAI: new GoogleGenerativeAI(apiKey),
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  };
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
    parsedSkills: [],
    parsedExperience: [],
    parsedEducation: [],
    parseConfidence: 0,
    parseReviewRequired: true,
    parseStatus: "failed",
    parseProvider: provider,
    warnings: [warning],
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
    return value
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item));
  }

  const asString = normalizeString(value);
  if (!asString) return [];
  return asString
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeExperience(value: unknown): ParsedExperienceItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      company: normalizeString(record.company),
      title: normalizeString(record.title),
      startDate: normalizeString(record.startDate),
      endDate: normalizeString(record.endDate),
      highlights: normalizeStringList(record.highlights),
    };
  });
}

function normalizeEducation(value: unknown): ParsedEducationItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      institution: normalizeString(record.institution),
      degree: normalizeString(record.degree),
      fieldOfStudy: normalizeString(record.fieldOfStudy),
      startDate: normalizeString(record.startDate),
      endDate: normalizeString(record.endDate),
    };
  });
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item));
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

function buildFallbackSummary(candidate: ParsedCandidate): string | null {
  const parts: string[] = [];
  if (candidate.currentTitle) parts.push(candidate.currentTitle);
  if (candidate.yearsExperience != null) parts.push(`with ${candidate.yearsExperience} years of experience`);
  if (candidate.parsedSkills.length) parts.push(`skilled in ${candidate.parsedSkills.slice(0, 5).join(", ")}`);
  if (candidate.location) parts.push(`based in ${candidate.location}`);
  if (!parts.length) return null;
  const sentence = parts.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

function extractLikelyTitle(lines: string[]): string | null {
  const titleKeywords =
    /\b(operator|engineer|developer|manager|specialist|technician|analyst|consultant|designer|coordinator|welder|machinist|accountant|assistant|tora|cnc)\b/i;

  for (const line of lines.slice(0, 8)) {
    if (!line || /@|http|linkedin|github|\d{5,}/i.test(line)) continue;
    const normalized = normalizeHeading(line);
    if (ALL_SECTION_HEADINGS.includes(normalized)) continue;
    if (titleKeywords.test(line)) {
      return normalizeString(line);
    }
  }

  const fallback = normalizeString(lines[1]);
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

function extractHeuristicCandidate(cvText: string): ParsedCandidate {
  const lines = getDocumentLines(cvText);
  const normalizedText = cvText.replace(/\u00a0/g, " ").trim();
  const { firstName, lastName } = extractName(lines);
  const email = normalizedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = normalizePhone(
    normalizedText
      .match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0]
      ?.replace(/\s{2,}/g, " ")
      .trim() ?? null,
  );
  const yearsExperience =
    toNumber(normalizedText.match(/(\d{1,2})\+?\s+(?:years?|yrs?)/i)?.[1] ?? null) ??
    toNumber(normalizedText.match(/experience[^.\n]{0,20}(\d{1,2})/i)?.[1] ?? null);
  const skillsLines = getSectionLines(lines, SECTION_HEADINGS.skills);
  const languagesLines = getSectionLines(lines, SECTION_HEADINGS.languages, 6);
  const educationLines = getSectionLines(lines, SECTION_HEADINGS.education, 6);
  const summaryLines = getSectionLines(lines, SECTION_HEADINGS.summary, 5);
  const experienceLines = getSectionLines(lines, SECTION_HEADINGS.experience, 14);

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
  const summary = normalizeString(summaryLines.join(" "));
  const parsedExperience = experienceLines.length
    ? [
        {
          title: normalizeString(experienceLines[0]) ?? currentTitle,
          company: normalizeString(experienceLines[1]),
          startDate: normalizeString(
            experienceLines.join(" ").match(/\b(?:19|20)\d{2}\b(?:\s*[-–]\s*\b(?:19|20)\d{2}\b|[-–]\s*present|\s*present)?/i)?.[0] ?? null,
          ),
          endDate: null,
          highlights: experienceLines.slice(2, 7).map((line) => line.replace(/^[•\-–]\s*/, "")).filter(Boolean),
        },
      ]
    : [];

  const parsedEducation = educationLines.length
    ? [
        {
          institution: normalizeString(educationLines[0]),
          degree: normalizeString(educationLines[1]),
          fieldOfStudy: normalizeString(educationLines[2]),
          startDate: null,
          endDate: null,
        },
      ]
    : [];

  const location =
    normalizeString(
      normalizedText.match(/\b(?:Istanbul|İstanbul|Ankara|Izmir|İzmir|Bursa|Kocaeli|Antalya|Adana|Konya|Turkey|Türkiye|Remote)\b/i)?.[0] ??
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
  candidate.parsedExperience = parsedExperience;
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
  const parseConfidenceRaw = toNumber(parsed.parseConfidence);

  const candidate: ParsedCandidate = {
    firstName: normalizeString(parsed.firstName),
    lastName: normalizeString(parsed.lastName),
    email: normalizeString(parsed.email),
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

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParseModule = (await import("pdf-parse")) as unknown as {
    PDFParse?: new (options: { data: Buffer }) => {
      getText: () => Promise<{ text?: string }>;
      destroy?: () => Promise<void>;
    };
  };
  const PDFParse = pdfParseModule.PDFParse;

  if (typeof PDFParse !== "function") {
    throw new Error("pdf-parse PDFParse export is not available");
  }

  const parser = new PDFParse({ data: buffer });
  const data = await parser.getText();
  await parser.destroy?.();
  const text = (data?.text || "").trim();
  if (!text) {
    throw new Error("PDF contains no readable text");
  }
  return text;
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (!text) {
    throw new Error("DOCX contains no readable text");
  }
  return text;
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
  const systemPrompt = buildUniversalPrompt();
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              "Normalize the following resume text into the requested JSON.",
              "",
              cvText.slice(0, 22000),
            ].join("\n"),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      return normalizeParsedCandidate(extractJsonObject(raw), provider);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorMsg = lastError.message;
      console.warn(`[CV Parse] provider=${provider} model=${model} failed: ${errorMsg}`);
      if (errorMsg.includes("rate") || errorMsg.includes("429")) {
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

  const model = gemini.genAI.getGenerativeModel({ model: gemini.model });
  const prompt = [
    buildUniversalPrompt(),
    "",
    params.fileName ? `File name: ${params.fileName}` : "",
    "Analyze the attached resume document directly. If the document is scanned, perform OCR mentally and still return partial structured output instead of failing.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await model.generateContent({
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
  } as any);

  const raw = result.response.text();
  return normalizeParsedCandidate(extractJsonObject(raw), `gemini:${gemini.model}`);
}

async function parseWithGeminiText(cvText: string): Promise<ParsedCandidate> {
  const gemini = getGeminiClient();
  if (!gemini) {
    throw new Error("Gemini is not configured.");
  }

  const model = gemini.genAI.getGenerativeModel({ model: gemini.model });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [buildUniversalPrompt(), "", cvText.slice(0, 24000)].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  } as any);

  return normalizeParsedCandidate(extractJsonObject(result.response.text()), `gemini:${gemini.model}`);
}

function finalizeResponse(candidate: ParsedCandidate, extraWarnings: string[] = []): ParsedCandidate {
  const mergedWarnings = [...candidate.warnings, ...extraWarnings].filter(Boolean);
  const dedupedWarnings = Array.from(new Set(mergedWarnings));
  const normalized = {
    ...candidate,
    warnings: dedupedWarnings,
    standardizedProfile: buildStandardizedProfile(candidate),
  };
  normalized.parseStatus = deriveStatus(normalized);
  normalized.parseReviewRequired =
    normalized.parseReviewRequired ||
    normalized.parseStatus !== "parsed" ||
    (normalized.parseConfidence ?? 0) < 65;

  const validated = CvParseResponseSchema.safeParse(normalized);
  if (!validated.success) {
    throw new Error("Normalized CV parse response failed validation");
  }

  return validated.data as ParsedCandidate;
}

router.post("/", requireAuth, requireRole("vendor"), async (req: Request, res: Response) => {
  try {
    const fileName = decodeHeaderFileName(req.headers["x-file-name"]);
    const kind = detectDocumentKind(req.headers["content-type"], fileName);
    const directGeminiAvailable = Boolean(getGeminiClient());
    const textProviderAvailable = Boolean(getAiClientConfig());

    if (kind === "json") {
      const bodyValidation = CvParseBodySchema.safeParse(req.body);
      if (!bodyValidation.success) {
        Errors.validation(res, bodyValidation.error.flatten());
        return;
      }

      const heuristicCandidate = extractHeuristicCandidate(bodyValidation.data.cvText);
      try {
        if (!directGeminiAvailable) throw new Error("Gemini is not configured.");
        const parsed = finalizeResponse(
          mergeParsedCandidates(await parseWithGeminiText(bodyValidation.data.cvText), heuristicCandidate),
        );
        res.json(parsed);
      } catch (geminiError) {
        console.warn("[CV Parse] Gemini text path failed, using fallback text provider.", geminiError);
        if (textProviderAvailable) {
          res.json(
            finalizeResponse(
              mergeParsedCandidates(await parseWithOpenAiText(bodyValidation.data.cvText), heuristicCandidate),
              ["A fallback text parser was used for this resume."],
            ),
          );
          return;
        }
        res.json(finalizeResponse(heuristicCandidate, ["Resume text heuristics were used because AI parsing is unavailable."]));
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

    if (kind === "pdf" || kind === "image") {
      try {
        if (!directGeminiAvailable) throw new Error("Gemini is not configured.");
        const parsed = await parseWithGeminiDocument({
          buffer,
          mimeType: req.headers["content-type"] || (kind === "pdf" ? "application/pdf" : "image/jpeg"),
          fileName,
        });
        res.json(finalizeResponse(parsed));
        return;
      } catch (geminiError) {
        console.warn("[CV Parse] Gemini document path failed.", geminiError);
        warnings.push("The server could not read this resume directly.");
      }
    }

    let extractedText = "";
    try {
      if (kind === "pdf") {
        extractedText = await extractTextFromPdf(buffer);
      } else if (kind === "docx") {
        extractedText = await extractTextFromDocx(buffer);
      }
    } catch (extractError) {
      const message = extractError instanceof Error ? extractError.message : "Unknown extraction error";
      warnings.push(message);
    }

    if (!extractedText && kind === "image") {
      res.json(
        finalizeResponse(
          createEmptyParse("image-fallback", "This image CV needs Gemini OCR or manual review."),
          warnings,
        ),
      );
      return;
    }

    if (!extractedText) {
      res.json(
        finalizeResponse(
          createEmptyParse(null, "The document could not be converted into text automatically."),
          warnings,
        ),
      );
      return;
    }

    const heuristicCandidate = extractHeuristicCandidate(extractedText);

    try {
      if (!directGeminiAvailable) throw new Error("Gemini is not configured.");
      const parsed = await parseWithGeminiText(extractedText);
      res.json(finalizeResponse(mergeParsedCandidates(parsed, heuristicCandidate), warnings));
      return;
    } catch (geminiTextError) {
      console.warn("[CV Parse] Gemini text fallback failed.", geminiTextError);
      warnings.push("A fallback text parser was used for this resume.");
    }

    if (textProviderAvailable) {
      const fallback = await parseWithOpenAiText(extractedText);
      res.json(finalizeResponse(mergeParsedCandidates(fallback, heuristicCandidate), warnings));
      return;
    }

    res.json(finalizeResponse(heuristicCandidate, [...warnings, "Resume text heuristics were used because no AI provider is configured."]));
  } catch (err) {
    console.error("CV parse error:", err);
    Errors.internal(res, "CV parsing failed");
  }
});

export default router;
