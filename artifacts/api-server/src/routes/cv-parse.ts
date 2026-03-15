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
  return trimmed ? trimmed : null;
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

function buildStandardizedProfile(candidate: ParsedCandidate): string | null {
  if (candidate.standardizedProfile) return candidate.standardizedProfile;
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

function normalizeParsedCandidate(parsed: Record<string, unknown>, provider: string | null): ParsedCandidate {
  const parsedSkills = normalizeStringList(parsed.parsedSkills ?? parsed.skills);
  const parsedExperience = normalizeExperience(parsed.parsedExperience ?? parsed.experience);
  const parsedEducation = normalizeEducation(parsed.parsedEducation ?? parsed.educationItems);
  const parseConfidenceRaw = toNumber(parsed.parseConfidence);

  const candidate: ParsedCandidate = {
    firstName: normalizeString(parsed.firstName),
    lastName: normalizeString(parsed.lastName),
    email: normalizeString(parsed.email),
    phone: normalizeString(parsed.phone),
    skills: normalizeString(parsed.skills) ?? (parsedSkills.length ? parsedSkills.join(", ") : null),
    expectedSalary: toNumber(parsed.expectedSalary),
    currentTitle: normalizeString(parsed.currentTitle),
    location: normalizeString(parsed.location),
    yearsExperience: toNumber(parsed.yearsExperience),
    education: normalizeString(parsed.education),
    languages: normalizeString(parsed.languages),
    summary: normalizeString(parsed.summary),
    standardizedProfile: normalizeString(parsed.standardizedProfile),
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
    return createEmptyParse(null, "Gemini is not configured.");
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
    return createEmptyParse(null, "Gemini is not configured.");
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

    if (kind === "json") {
      const bodyValidation = CvParseBodySchema.safeParse(req.body);
      if (!bodyValidation.success) {
        Errors.validation(res, bodyValidation.error.flatten());
        return;
      }

      try {
        const parsed = finalizeResponse(await parseWithGeminiText(bodyValidation.data.cvText));
        res.json(parsed);
      } catch (geminiError) {
        console.warn("[CV Parse] Gemini text path failed, using fallback text provider.", geminiError);
        res.json(finalizeResponse(await parseWithOpenAiText(bodyValidation.data.cvText), [
          "Primary AI parser was unavailable, so a fallback text parser was used.",
        ]));
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
        const parsed = await parseWithGeminiDocument({
          buffer,
          mimeType: req.headers["content-type"] || (kind === "pdf" ? "application/pdf" : "image/jpeg"),
          fileName,
        });
        res.json(finalizeResponse(parsed));
        return;
      } catch (geminiError) {
        console.warn("[CV Parse] Gemini document path failed.", geminiError);
        warnings.push("Primary document parser could not read the file directly.");
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

    try {
      const parsed = await parseWithGeminiText(extractedText);
      res.json(finalizeResponse(parsed, warnings));
      return;
    } catch (geminiTextError) {
      console.warn("[CV Parse] Gemini text fallback failed.", geminiTextError);
      warnings.push("Primary AI parser was unavailable, so a fallback text parser was used.");
    }

    const fallback = await parseWithOpenAiText(extractedText);
    res.json(finalizeResponse(fallback, warnings));
  } catch (err) {
    console.error("CV parse error:", err);
    Errors.internal(res, "CV parsing failed");
  }
});

export default router;
