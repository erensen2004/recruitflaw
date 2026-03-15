import { raw, Router } from "express";
import { access, mkdir, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import OpenAI from "openai";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { requireAuth } from "../lib/auth.js";
import { requireRole } from "../lib/authz.js";
import { CvParseBodySchema, CvParseResponseSchema } from "../lib/schemas.js";
import { Errors } from "../lib/errors.js";

const router = Router();
const MAX_VERCEL_PDF_BYTES = Number(process.env.MAX_CV_PARSE_PDF_BYTES || "4000000");
const OCR_MAX_PAGES = Math.max(1, Number(process.env.CV_PARSE_OCR_MAX_PAGES || "2"));
const OCR_LANGUAGES = process.env.CV_PARSE_OCR_LANGUAGES || "eng";
const OCR_RENDER_SCALE = Math.max(1, Number(process.env.CV_PARSE_OCR_RENDER_SCALE || "1.25"));
const OCR_LANG_DATA_DIR = path.join(process.cwd(), "artifacts", "api-server");
const OCR_CACHE_DIR = path.join(tmpdir(), "recruitflaw-tesseract-cache");
const OCR_LANG_TMP_DIR = path.join(tmpdir(), "recruitflaw-tesseract-lang");
const requireFromHere =
  typeof require === "function"
    ? require
    : createRequire(path.join(process.cwd(), "__cv_parse_resolver__.cjs"));
let pdfJsCanvasShimPromise: Promise<void> | undefined;
const localOcrLangDirPromises = new Map<string, Promise<string>>();

const DEFAULT_OPENROUTER_MODELS = [
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-1.2b-instruct:free",
];

function getConfiguredModels(): string[] {
  const configured =
    process.env.OPENROUTER_MODEL ||
    process.env.OPENAI_CV_PARSE_MODEL ||
    process.env.CV_PARSE_MODEL;

  if (!configured) {
    return DEFAULT_OPENROUTER_MODELS;
  }

  return configured
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function getAiClientConfig(): {
  client: OpenAI;
  models: string[];
  provider: "openrouter" | "openai" | "replit";
} {
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

  throw new Error("AI service not configured");
}

function buildSystemPrompt(): string {
  return [
    "You normalize CVs into a single ATS intake format.",
    "Return exactly one JSON object and nothing else.",
    "If a field is missing or unclear, use null.",
    "Do not invent salary, experience, or contact details.",
    "skills must be a concise comma-separated list of the strongest hard skills.",
    "summary must be a short recruiter-friendly summary in plain English.",
    "standardizedProfile must be a compact normalized profile with this order:",
    "Headline | Contact | Location | Experience | Skills | Education | Languages.",
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
    ].join(", "),
  ].join(" ");
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

function normalizeParsedCandidate(parsed: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
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
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (key in normalized) {
      normalized[key] = value ?? null;
    }
  }

  return normalized;
}

function isMeaningfulPdfText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(normalized)) {
    return false;
  }

  const letters = normalized.match(/\p{L}/gu) ?? [];
  return letters.length >= 24;
}

async function ensurePdfJsCanvasShim(): Promise<void> {
  if (!pdfJsCanvasShimPromise) {
    pdfJsCanvasShimPromise = (async () => {
      const resolvedCanvasPath = requireFromHere.resolve("@napi-rs/canvas");
      const shimRoot = path.join(tmpdir(), "recruitflaw-pdfjs-shim");
      const shimNodeModules = path.join(shimRoot, "node_modules");
      const shimPackageDir = path.join(shimNodeModules, "@napi-rs", "canvas");

      await mkdir(shimPackageDir, { recursive: true });
      await writeFile(
        path.join(shimPackageDir, "package.json"),
        JSON.stringify(
          {
            name: "@napi-rs/canvas",
            main: "index.cjs",
          },
          null,
          2,
        ),
      );
      await writeFile(
        path.join(shimPackageDir, "index.cjs"),
        `module.exports = require(${JSON.stringify(resolvedCanvasPath)});\n`,
      );

      const existingNodePath = (process.env.NODE_PATH || "")
        .split(path.delimiter)
        .filter(Boolean);
      if (!existingNodePath.includes(shimNodeModules)) {
        process.env.NODE_PATH = [shimNodeModules, ...existingNodePath].join(path.delimiter);
        (Module as unknown as { _initPaths?: () => void })._initPaths?.();
      }
    })();
  }

  await pdfJsCanvasShimPromise;
}

async function renderPdfPagesToImages(buffer: Buffer): Promise<Buffer[]> {
  await ensurePdfJsCanvasShim();
  const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

  // pdfjs expects DOM-like globals even in a server runtime.
  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.Path2D ??= Path2D;
  (globalThis as typeof globalThis & { pdfjsWorker?: object }).pdfjsWorker ??= pdfjsWorker;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  try {
    const pageCount = Math.min(pdf.numPages, OCR_MAX_PAGES);
    const images: Buffer[] = [];

    for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const canvasContext = canvas.getContext("2d");

      await page.render({ canvas, canvasContext, viewport }).promise;
      images.push(canvas.toBuffer("image/png"));
    }

    return images;
  } finally {
    await loadingTask.destroy();
  }
}

async function extractTextLayerWithPdfJs(buffer: Buffer): Promise<string> {
  await ensurePdfJsCanvasShim();
  const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.Path2D ??= Path2D;
  (globalThis as typeof globalThis & { pdfjsWorker?: object }).pdfjsWorker ??= pdfjsWorker;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  try {
    const chunks: string[] = [];

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();

      if (pageText) {
        chunks.push(pageText);
      }
    }

    return chunks.join("\n\n").trim();
  } finally {
    await loadingTask.destroy();
  }
}

async function ensureLocalOcrLanguageData(language: string): Promise<string> {
  const existingPromise = localOcrLangDirPromises.get(language);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
    const languageDir = path.join(OCR_LANG_TMP_DIR, language);
    const trainedDataPath = path.join(languageDir, `${language}.traineddata`);

    try {
      await access(trainedDataPath);
      return languageDir;
    } catch {
      // Fall through and populate the cache.
    }

    await mkdir(languageDir, { recursive: true });

    const platformHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const normalizedHost = platformHost?.replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (normalizedHost) {
      const url = `https://${normalizedHost}/ocr/${language}.traineddata.gz`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download OCR language data (${response.status} ${response.statusText})`);
      }

      const compressed = Buffer.from(await response.arrayBuffer());
      const trainedData = gunzipSync(compressed);
      await writeFile(trainedDataPath, trainedData);
      return languageDir;
    }

    return OCR_LANG_DATA_DIR;
  })();

  localOcrLangDirPromises.set(language, promise);
  return promise;
}

async function extractTextWithOcr(images: Buffer[]): Promise<string> {
  const primaryLanguage = OCR_LANGUAGES.split("+").map((value) => value.trim()).find(Boolean) || "eng";
  const langPath = await ensureLocalOcrLanguageData(primaryLanguage);
  const worker = await createWorker(OCR_LANGUAGES, 1, {
    langPath,
    cachePath: OCR_CACHE_DIR,
    gzip: false,
  });

  try {
    const pages: string[] = [];

    for (const image of images) {
      const result = await worker.recognize(image);
      const text = result.data.text.trim();
      if (text) {
        pages.push(text);
      }
    }

    return pages.join("\n\n").trim();
  } finally {
    await worker.terminate();
  }
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const failures: string[] = [];

  try {
    const text = await extractTextLayerWithPdfJs(buffer);
    if (isMeaningfulPdfText(text)) {
      return text;
    }

    failures.push("PDF contains no readable text layer");
  } catch (err) {
    failures.push(`Text-layer extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const images = await renderPdfPagesToImages(buffer);
    const text = await extractTextWithOcr(images);

    if (isMeaningfulPdfText(text)) {
      return text;
    }

    failures.push("OCR extracted no readable text");
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  }

  throw new Error(`PDF extraction failed: ${failures.join(" | ")}`);
}

async function parseWithAI(cvText: string): Promise<Record<string, unknown>> {
  const { client, models, provider } = getAiClientConfig();
  const systemPrompt = buildSystemPrompt();
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              "Normalize this CV into a single ATS format.",
              "",
              "Return one JSON object with the requested keys.",
              "",
              cvText.slice(0, 16000),
            ].join("\n"),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = normalizeParsedCandidate(extractJsonObject(raw));
      console.log(`[CV Parse] Success provider=${provider} model=${model}`);
      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorMsg = lastError.message;
      console.warn(`[CV Parse] provider=${provider} model=${model} failed: ${errorMsg}`);

      if (errorMsg.includes("rate") || errorMsg.includes("429")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError || new Error("All CV parsing models failed");
}

router.post(
  "/",
  raw({ type: "application/pdf", limit: `${MAX_VERCEL_PDF_BYTES}b` }),
  requireAuth,
  requireRole("vendor"),
  async (req: any, res: any) => {
    try {
      const hasAiProvider = Boolean(
        process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.REPLIT_AI_TOKEN,
      );
      if (!hasAiProvider) {
        Errors.serviceUnavailable(res, "AI service not configured");
        return;
      }

      let cvText: string;

      if (req.headers["content-type"]?.includes("application/pdf")) {
        const pdfBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body || []);

        if (!pdfBuffer.length) {
          Errors.badRequest(res, "PDF body is empty");
          return;
        }

        try {
          cvText = await extractTextFromPdf(pdfBuffer);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          Errors.badRequest(res, `Failed to extract text from PDF: ${errorMsg}`);
          return;
        }
      } else {
        const bodyValidation = CvParseBodySchema.safeParse(req.body);
        if (!bodyValidation.success) {
          Errors.validation(res, bodyValidation.error.flatten());
          return;
        }
        cvText = bodyValidation.data.cvText;
      }

      let parsedJson: Record<string, unknown>;
      try {
        parsedJson = await parseWithAI(cvText);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message === "AI service not configured") {
          Errors.serviceUnavailable(res, "AI service not configured");
        } else if (message.includes("JSON")) {
          Errors.badRequest(res, "AI returned invalid JSON");
        } else {
          Errors.badRequest(res, `CV parsing provider error: ${message}`);
        }
        return;
      }

      const validated = CvParseResponseSchema.safeParse(parsedJson);
      if (!validated.success) {
        Errors.validation(res, validated.error.flatten());
        return;
      }

      res.json(validated.data);
    } catch (err) {
      console.error("CV parse error:", err);
      Errors.internal(res, "CV parsing failed");
    }
  },
);

export default router;
