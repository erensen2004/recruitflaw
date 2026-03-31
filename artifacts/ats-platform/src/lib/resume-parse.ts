export type ParsedCandidateProfile = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  skills?: string | null;
  expectedSalary?: number | null;
  currentTitle?: string | null;
  location?: string | null;
  yearsExperience?: number | null;
  education?: string | null;
  languages?: string | null;
  summary?: string | null;
  standardizedProfile?: string | null;
  executiveHeadline?: string | null;
  professionalSnapshot?: string | null;
  domainFocus?: string[];
  senioritySignal?: string | null;
  candidateStrengths?: string[];
  candidateRisks?: string[];
  notableAchievements?: string[];
  inferredWorkModel?: string | null;
  locationFlexibility?: string | null;
  salarySignal?: string | null;
  languageItems?: Array<{
    name?: string | null;
    level?: string | null;
    confidence?: number | null;
    source?: string | null;
  }>;
  fieldConfidence?: {
    contact?: number | null;
    experience?: number | null;
    education?: number | null;
    languages?: number | null;
    compensation?: number | null;
    summary?: number | null;
  } | null;
  evidence?: string[];
  parsedSkills?: string[];
  parsedExperience?: Array<{
    company?: string | null;
    title?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    highlights?: string[];
    scope?: string | null;
    techStack?: string[];
    impactHighlights?: string[];
    current?: boolean | null;
    seniorityContribution?: string | null;
  }>;
  parsedEducation?: Array<{
    institution?: string | null;
    degree?: string | null;
    fieldOfStudy?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    confidence?: number | null;
  }>;
  parseStatus?: "not_started" | "processing" | "parsed" | "partial" | "failed";
  parseConfidence?: number | null;
  parseReviewRequired?: boolean;
  parseProvider?: string | null;
  warnings?: string[];
};

type ProgressCallback = (message: string) => void;

type ParseDocumentOptions = {
  file: File;
  token: string | null;
  onProgress?: ProgressCallback;
};

const OCR_PAGE_LIMIT = 3;
const OCR_PRIMARY_SCALE = 2.4;
const OCR_RETRY_SCALE = 3.2;
const OCR_RETRY_TEXT_LENGTH = 120;
const MIN_TEXT_LENGTH = 180;

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function signalScore(parsed: ParsedCandidateProfile) {
  let score = 0;
  if (parsed.firstName || parsed.lastName) score += 15;
  if (parsed.email) score += 20;
  if (parsed.phone) score += 12;
  if (parsed.currentTitle) score += 10;
  if (parsed.location) score += 6;
  if (parsed.summary) score += 12;
  if (parsed.executiveHeadline) score += 8;
  if (parsed.professionalSnapshot) score += 10;
  if (parsed.parsedSkills?.length) score += Math.min(18, parsed.parsedSkills.length * 3);
  if (parsed.parsedExperience?.length) score += Math.min(20, parsed.parsedExperience.length * 8);
  if (parsed.parsedEducation?.length) score += Math.min(12, parsed.parsedEducation.length * 6);
  if (parsed.languages) score += 5;
  return score;
}

function countStructuredSections(parsed: ParsedCandidateProfile) {
  return [
    parsed.parsedExperience?.length ? 1 : 0,
    parsed.parsedEducation?.length ? 1 : 0,
    parsed.languages ? 1 : 0,
    parsed.yearsExperience != null ? 1 : 0,
  ].reduce((total, current) => total + current, 0);
}

function countIdentitySignals(parsed: ParsedCandidateProfile) {
  return [
    parsed.firstName || parsed.lastName ? 1 : 0,
    parsed.email ? 1 : 0,
    parsed.phone ? 1 : 0,
    parsed.currentTitle ? 1 : 0,
    parsed.location ? 1 : 0,
  ].reduce((total, current) => total + current, 0);
}

function looksWeak(parsed: ParsedCandidateProfile) {
  const warningText = parsed.warnings?.join(" ").toLowerCase() ?? "";
  const structuredSections = countStructuredSections(parsed);
  const identitySignals = countIdentitySignals(parsed);
  const confidence = parsed.parseConfidence ?? 0;

  if (parsed.parseStatus === "parsed" && !parsed.parseReviewRequired && confidence >= 78 && structuredSections >= 2) {
    return false;
  }

  return (
    parsed.parseStatus === "failed" ||
    signalScore(parsed) < 52 ||
    confidence < 50 ||
    structuredSections === 0 ||
    identitySignals < 2 ||
    (parsed.parseReviewRequired && structuredSections < 2) ||
    /could not read|could not be converted|no resume content provided|heuristics were used|fallback text parser was used/.test(
      warningText,
    )
  );
}

function mergeParsedProfiles(primary: ParsedCandidateProfile, secondary: ParsedCandidateProfile): ParsedCandidateProfile {
  const merged: ParsedCandidateProfile = {
    ...secondary,
    ...primary,
    firstName: primary.firstName ?? secondary.firstName ?? null,
    lastName: primary.lastName ?? secondary.lastName ?? null,
    email: primary.email ?? secondary.email ?? null,
    phone: primary.phone ?? secondary.phone ?? null,
    skills: primary.skills ?? secondary.skills ?? null,
    expectedSalary: primary.expectedSalary ?? secondary.expectedSalary ?? null,
    currentTitle: primary.currentTitle ?? secondary.currentTitle ?? null,
    location: primary.location ?? secondary.location ?? null,
    yearsExperience: primary.yearsExperience ?? secondary.yearsExperience ?? null,
    education: primary.education ?? secondary.education ?? null,
    languages: primary.languages ?? secondary.languages ?? null,
    summary: primary.summary ?? secondary.summary ?? null,
    standardizedProfile: primary.standardizedProfile ?? secondary.standardizedProfile ?? null,
    executiveHeadline: primary.executiveHeadline ?? secondary.executiveHeadline ?? null,
    professionalSnapshot: primary.professionalSnapshot ?? secondary.professionalSnapshot ?? null,
    domainFocus: primary.domainFocus?.length ? primary.domainFocus : secondary.domainFocus ?? [],
    senioritySignal: primary.senioritySignal ?? secondary.senioritySignal ?? null,
    candidateStrengths:
      primary.candidateStrengths?.length ? primary.candidateStrengths : secondary.candidateStrengths ?? [],
    candidateRisks:
      primary.candidateRisks?.length ? primary.candidateRisks : secondary.candidateRisks ?? [],
    notableAchievements:
      primary.notableAchievements?.length ? primary.notableAchievements : secondary.notableAchievements ?? [],
    inferredWorkModel: primary.inferredWorkModel ?? secondary.inferredWorkModel ?? null,
    locationFlexibility: primary.locationFlexibility ?? secondary.locationFlexibility ?? null,
    salarySignal: primary.salarySignal ?? secondary.salarySignal ?? null,
    languageItems: primary.languageItems?.length ? primary.languageItems : secondary.languageItems ?? [],
    fieldConfidence: primary.fieldConfidence ?? secondary.fieldConfidence ?? null,
    evidence: primary.evidence?.length ? primary.evidence : secondary.evidence ?? [],
    parsedSkills: primary.parsedSkills?.length ? primary.parsedSkills : secondary.parsedSkills ?? [],
    parsedExperience:
      primary.parsedExperience?.length ? primary.parsedExperience : secondary.parsedExperience ?? [],
    parsedEducation:
      primary.parsedEducation?.length ? primary.parsedEducation : secondary.parsedEducation ?? [],
    warnings: uniqueStrings([...(secondary.warnings ?? []), ...(primary.warnings ?? [])]),
  };

  merged.parseConfidence = Math.max(primary.parseConfidence ?? 0, secondary.parseConfidence ?? 0);
  merged.parseReviewRequired = Boolean(primary.parseReviewRequired || secondary.parseReviewRequired);
  merged.parseStatus =
    primary.parseStatus === "parsed" || secondary.parseStatus === "parsed"
      ? "parsed"
      : primary.parseStatus === "partial" || secondary.parseStatus === "partial"
        ? "partial"
        : primary.parseStatus ?? secondary.parseStatus ?? "failed";

  return merged;
}

async function parseDocumentOnServer(file: File, token: string | null) {
  const res = await fetch("/api/cv-parse", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });

  if (!res.ok) {
    throw new Error(await getErrorMessage(res));
  }

  return (await res.json()) as ParsedCandidateProfile;
}

async function parseTextOnServer(cvText: string, token: string | null) {
  const res = await fetch("/api/cv-parse", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cvText }),
  });

  if (!res.ok) {
    throw new Error(await getErrorMessage(res));
  }

  return (await res.json()) as ParsedCandidateProfile;
}

async function getPdfModule() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
  }
  return pdfjs;
}

async function extractPdfTextInBrowser(file: File) {
  const pdfjs = await getPdfModule();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data } as any).promise;

  const chunks: string[] = [];
  const pageCount = Math.min(pdf.numPages, 4);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) chunks.push(text);
  }

  return chunks.join("\n").trim();
}

function createCanvas(viewport: { width: number; height: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function enhanceCanvasForOcr(sourceCanvas: HTMLCanvasElement) {
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;

  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const targetContext = targetCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || !targetContext) {
    return sourceCanvas;
  }

  const imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const { data } = imageData;
  const contrast = 1.45;
  const brightness = -4;

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const adjusted = Math.max(
      0,
      Math.min(255, Math.round((gray - 128) * contrast + 128 + brightness)),
    );
    const boosted = gray > 245 ? 255 : adjusted;
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }

  targetContext.putImageData(imageData, 0, 0);
  return targetCanvas;
}

async function runTesseractOcr(image: HTMLCanvasElement | File, onProgress?: ProgressCallback) {
  const { createWorker } = await import("tesseract.js");
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const firstArg = typeof args[0] === "string" ? args[0] : "";
    if (/estimating resolution/i.test(firstArg)) {
      return;
    }
    originalConsoleError(...args);
  };
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (typeof message?.progress === "number" && onProgress) {
        onProgress(`Running OCR… ${Math.round(message.progress * 100)}%`);
      }
    },
  });

  try {
    const { data } = await worker.recognize(image, { rotateAuto: true });
    return data.text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await worker.terminate();
    console.error = originalConsoleError;
  }
}

async function renderPdfPageForOcr(page: any, scale: number) {
  const viewport = page.getViewport({ scale });
  const { canvas, context } = createCanvas(viewport);
  await page.render({ canvasContext: context, viewport, canvas } as any).promise;
  return enhanceCanvasForOcr(canvas);
}

async function ocrPdfPage(page: any, pageNumber: number, pageCount: number, onProgress?: ProgressCallback) {
  const attempts = [OCR_PRIMARY_SCALE, OCR_RETRY_SCALE];
  let bestText = "";

  for (const [index, scale] of attempts.entries()) {
    onProgress?.(
      `Scanning PDF page ${pageNumber}/${pageCount} in the browser${index > 0 ? " (quality retry)" : ""}…`,
    );
    const canvas = await renderPdfPageForOcr(page, scale);
    const text = await runTesseractOcr(canvas, onProgress);
    if (text.length > bestText.length) {
      bestText = text;
    }
    if (text.length >= OCR_RETRY_TEXT_LENGTH) {
      break;
    }
  }

  return bestText.trim();
}

async function extractPdfTextWithOcr(file: File, onProgress?: ProgressCallback) {
  const pdfjs = await getPdfModule();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data } as any).promise;
  const pageCount = Math.min(pdf.numPages, OCR_PAGE_LIMIT);
  const ocrPages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await ocrPdfPage(page, pageNumber, pageCount, onProgress);
    if (text) ocrPages.push(text);
  }

  return ocrPages.join("\n\n").trim();
}

async function extractTextInBrowser(file: File, onProgress?: ProgressCallback) {
  const lowerType = file.type.toLowerCase();
  const lowerName = file.name.toLowerCase();
  const isPdf = lowerType.includes("pdf") || lowerName.endsWith(".pdf");
  const isImage = lowerType.startsWith("image/");

  if (isPdf) {
    onProgress?.("Trying browser PDF text extraction…");
    const extractedText = await extractPdfTextInBrowser(file);
    if (extractedText.length >= MIN_TEXT_LENGTH) {
      return extractedText;
    }

    onProgress?.("Trying scanned PDF fallback in the browser…");
    return extractPdfTextWithOcr(file, onProgress);
  }

  if (isImage) {
    onProgress?.("Reading image resume in the browser…");
    return runTesseractOcr(file, onProgress);
  }

  return "";
}

export async function parseResumeFileWithFallback({ file, token, onProgress }: ParseDocumentOptions) {
  onProgress?.("Uploading resume to the parser…");
  const serverParsed = await parseDocumentOnServer(file, token);
  const lowerType = file.type.toLowerCase();
  const lowerName = file.name.toLowerCase();
  const browserFallbackSupported =
    lowerType.includes("pdf") || lowerType.startsWith("image/") || lowerName.endsWith(".pdf");

  if (!browserFallbackSupported || !looksWeak(serverParsed)) {
    return serverParsed;
  }

  const browserText = await extractTextInBrowser(file, onProgress);
  if (!browserText || browserText.length < 50) {
    return mergeParsedProfiles(serverParsed, {
      parseStatus: "partial",
      parseReviewRequired: true,
      warnings: [
        "The browser fallback could not extract enough text from this resume.",
        ...(serverParsed.warnings ?? []),
      ],
    });
  }

  onProgress?.("Normalizing browser-extracted resume text…");
  const fallbackParsed = await parseTextOnServer(browserText, token);
  return mergeParsedProfiles(
    {
      ...fallbackParsed,
      warnings: uniqueStrings([
        "A browser fallback was used to improve extraction quality for this resume.",
        ...(serverParsed.warnings ?? []),
        ...(fallbackParsed.warnings ?? []),
      ]),
    },
    serverParsed,
  );
}

export async function parseResumeText(token: string | null, cvText: string) {
  return parseTextOnServer(cvText, token);
}

export async function getErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
    if (typeof data?.error === "string" && data.error.trim()) return data.error;
  } catch {
    // Ignore JSON parsing failures and fall back to status text.
  }

  return `${response.status} ${response.statusText}`.trim() || "Unknown error";
}
