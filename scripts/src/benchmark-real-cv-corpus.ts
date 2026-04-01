import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

type LanguageProfile = "tr" | "en" | "mixed";

type CorpusFileConfig = {
  path: string;
  languageProfile?: LanguageProfile;
  notes?: string;
};

type CorpusConfig = {
  baseUrl?: string;
  vendorAuth?: {
    email?: string;
    password?: string;
    passwordEnv?: string;
  };
  files: CorpusFileConfig[];
};

type ParseResponse = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
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
  domainFocus?: string[] | null;
  senioritySignal?: string | null;
  candidateStrengths?: string[] | null;
  candidateRisks?: string[] | null;
  notableAchievements?: string[] | null;
  inferredWorkModel?: string | null;
  locationFlexibility?: string | null;
  salarySignal?: string | null;
  languageItems?: Array<{
    name?: string | null;
    level?: string | null;
    confidence?: number | null;
    source?: string | null;
  }> | null;
  fieldConfidence?: {
    contact?: number | null;
    experience?: number | null;
    education?: number | null;
    languages?: number | null;
    compensation?: number | null;
    summary?: number | null;
  } | null;
  evidence?: string[] | null;
  parsedSkills?: string[] | null;
  parsedExperience?: Array<{
    company?: string | null;
    title?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    highlights?: string[] | null;
    scope?: string | null;
    techStack?: string[] | null;
    impactHighlights?: string[] | null;
    current?: boolean | null;
    seniorityContribution?: string | null;
  }> | null;
  parsedEducation?: Array<{
    institution?: string | null;
    degree?: string | null;
    fieldOfStudy?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    confidence?: number | null;
  }> | null;
  parseConfidence?: number | null;
  parseReviewRequired?: boolean | null;
  parseStatus?: string | null;
  parseProvider?: string | null;
  warnings?: string[] | null;
  extractionMethod?: string | null;
  extractionFallbackUsed?: boolean | null;
  extractionFailureClass?: "runtime" | "timeout" | "empty_text" | "oversized" | "ocr_required" | null;
  sourceTextLength?: number | null;
  sourceTextTruncated?: boolean | null;
};

type MetricKey =
  | "contact"
  | "headline"
  | "location"
  | "salary"
  | "experience"
  | "education"
  | "language"
  | "summary"
  | "executiveHeadline"
  | "standardizedCv";

type MetricScore = {
  score: number;
  max: number;
  note: string;
  weak?: boolean;
};

type FileMetadata = {
  fileName: string;
  format: "pdf" | "docx" | "unknown";
  sizeBytes: number;
  extractedTextChars: number;
  extractedTextWords: number;
  extractionQuality: "strong" | "usable" | "thin" | "failed";
  ocrRisk: "low" | "medium" | "high";
  languageProfile: LanguageProfile;
};

type FileBenchmarkResult = {
  filePath: string;
  metadata: FileMetadata;
  parseProvider: string | null;
  parseStatus: string | null;
  parseConfidence: number | null;
  parseReviewRequired: boolean;
  warnings: string[];
  metrics: Record<MetricKey, MetricScore>;
  totalScore: number;
  totalMax: number;
  classification: "good" | "usable but thin" | "needs review" | "fails recruiter brief quality";
  weakZones: string[];
  hallucinationRisk: "low" | "medium" | "high";
  structuredThinFlags: string[];
  extractionDebug: {
    method: string | null;
    fallbackUsed: boolean;
    failureClass: ParseResponse["extractionFailureClass"];
    sourceTextLength: number | null;
    sourceTextTruncated: boolean;
  };
  output: Pick<
    ParseResponse,
    | "firstName"
    | "lastName"
    | "email"
    | "phone"
    | "currentTitle"
    | "location"
    | "summary"
    | "executiveHeadline"
    | "professionalSnapshot"
    | "domainFocus"
    | "candidateStrengths"
    | "candidateRisks"
    | "notableAchievements"
    | "languages"
    | "languageItems"
    | "salarySignal"
    | "standardizedProfile"
  >;
};

type AggregateReport = {
  generatedAt: string;
  baseUrl: string;
  corpusPath: string;
  files: FileBenchmarkResult[];
  totals: {
    files: number;
    averageScore: string;
    classifications: Record<FileBenchmarkResult["classification"], number>;
  };
  recurringWeakZones: Array<{ zone: string; count: number }>;
  recurringStructuredThinFlags: Array<{ flag: string; count: number }>;
  recurringExtractionFailures: Array<{ failureClass: string; count: number }>;
  recurringWarnings: Array<{ warning: string; count: number }>;
  formatBreakdown: Array<{
    format: string;
    files: number;
    averageScore: string;
    highOcrRisk: number;
  }>;
  liquidVerdict: {
    decision: string;
    reasons: string[];
  };
  tuningBacklog: Array<{
    title: string;
    priority: "P0" | "P1" | "P2";
    rationale: string;
  }>;
};

const WORKSPACE_ROOT = path.resolve(process.cwd(), "..");
const DEFAULT_BASE_URL = "https://recruitflaw.vercel.app";
const DEFAULT_VENDOR_EMAIL = process.env.SMOKE_VENDOR_EMAIL || "vendor@staffingpro.com";
const DEFAULT_VENDOR_PASSWORD = process.env.SMOKE_VENDOR_PASSWORD || "vendor123";
const DEFAULT_CORPUS_PATH = path.resolve(WORKSPACE_ROOT, ".local/recruitflow-real-cv-corpus.json");
const REPORTS_DIR = path.resolve(WORKSPACE_ROOT, ".local/benchmark-reports");
const REQUEST_TIMEOUT_MS = 90_000;
const TEXT_FALLBACK_CHAR_LIMIT = 40_000;
const TURKISH_CITY_HINTS = [
  "istanbul",
  "ankara",
  "izmir",
  "kocaeli",
  "sakarya",
  "bursa",
  "antalya",
  "konya",
  "adana",
  "eskişehir",
];

function normalizeText(value?: string | null) {
  return (value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@.+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value?: string | null) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function pickDefined<T>(value: T | null | undefined, fallback: T) {
  return value == null ? fallback : value;
}

function containsValue(sourceText: string, candidateValue?: string | null) {
  if (!candidateValue) return false;
  const normalizedSource = normalizeText(sourceText);
  const normalizedValue = normalizeText(candidateValue);
  return normalizedValue.length >= 3 && normalizedSource.includes(normalizedValue);
}

function overlapRatio(sourceText: string, candidateValue?: string | null) {
  const sourceTokens = new Set(tokenize(sourceText));
  const valueTokens = tokenize(candidateValue);
  if (!valueTokens.length || !sourceTokens.size) return 0;
  const hits = valueTokens.filter((token) => sourceTokens.has(token)).length;
  return hits / valueTokens.length;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatScore(score: number, max: number) {
  return `${score}/${max}`;
}

function detectFormat(filePath: string): FileMetadata["format"] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  return "unknown";
}

function detectMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

function detectLanguageProfile(text: string): LanguageProfile {
  const normalized = normalizeText(text);
  if (!normalized) return "mixed";
  const turkishMarkers = [" ve ", " ile ", " için ", " deneyim ", " üniversite ", " mühendis ", "istanbul"];
  const englishMarkers = [" with ", " experience ", " engineer ", " summary ", " university ", " fluent "];
  const turkishHits = turkishMarkers.filter((marker) => normalized.includes(marker.trim())).length;
  const englishHits = englishMarkers.filter((marker) => normalized.includes(marker.trim())).length;
  const hasTurkishChars = /[çğıöşü]/i.test(text);
  if ((turkishHits >= 2 || hasTurkishChars) && englishHits >= 2) return "mixed";
  if (turkishHits >= 2 || hasTurkishChars) return "tr";
  if (englishHits >= 2) return "en";
  return "mixed";
}

async function extractTextFromPdf(buffer: Buffer) {
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
  const result = await parser.getText();
  await parser.destroy?.();
  return (result.text || "").replace(/\s{2,}/g, " ").trim();
}

async function extractTextFromDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || "").replace(/\s{2,}/g, " ").trim();
}

function inferExtractionQuality(text: string, sizeBytes: number): FileMetadata["extractionQuality"] {
  if (!text.trim()) return "failed";
  const chars = text.trim().length;
  if (chars >= 1200) return "strong";
  if (chars >= 500) return "usable";
  if (chars >= 120 || sizeBytes < 70_000) return "thin";
  return "failed";
}

function inferOcrRisk(format: FileMetadata["format"], text: string, sizeBytes: number): FileMetadata["ocrRisk"] {
  if (!text.trim()) return "high";
  if (format === "docx") return "low";
  const chars = text.trim().length;
  const charsPerKb = chars / Math.max(sizeBytes / 1024, 1);
  if (charsPerKb < 2 || chars < 250) return "high";
  if (charsPerKb < 5 || chars < 700) return "medium";
  return "low";
}

function extractEmails(text: string) {
  return Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []));
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function extractPhones(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  return Array.from(new Set(matches.map((item) => normalizePhone(item)).filter((item) => item.length >= 10)));
}

function extractSalarySignals(text: string) {
  const rawMatches = text.match(/(?:₺|tl|usd|eur|\$|€)\s*[\d.,]+|[\d.,]+\s*(?:tl|usd|eur)/gi) ?? [];
  return Array.from(new Set(rawMatches.map((item) => item.trim())));
}

function extractSourceCities(text: string) {
  const normalized = normalizeText(text);
  return TURKISH_CITY_HINTS.filter((city) => normalized.includes(city));
}

function inferMetadata(filePath: string, sizeBytes: number, extractedText: string, configuredLanguage?: LanguageProfile): FileMetadata {
  const extractedTextWords = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0;
  return {
    fileName: path.basename(filePath),
    format: detectFormat(filePath),
    sizeBytes,
    extractedTextChars: extractedText.length,
    extractedTextWords,
    extractionQuality: inferExtractionQuality(extractedText, sizeBytes),
    ocrRisk: inferOcrRisk(detectFormat(filePath), extractedText, sizeBytes),
    languageProfile: configuredLanguage || detectLanguageProfile(extractedText),
  };
}

async function login(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

async function parseFile(
  baseUrl: string,
  token: string,
  filePath: string,
  buffer: Buffer,
  extractedText: string,
) {
  const response = await fetch(`${baseUrl}/api/cv-parse`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": detectMimeType(filePath),
      "X-File-Name": encodeURIComponent(path.basename(filePath)),
    },
    body: buffer,
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // keep text
  }

  if (response.status === 413 && extractedText.trim()) {
    const compactText = extractedText.slice(0, TEXT_FALLBACK_CHAR_LIMIT);
    const fallbackResponse = await fetch(`${baseUrl}/api/cv-parse`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cvText: compactText }),
    });
    const fallbackText = await fallbackResponse.text();
    let fallbackPayload: unknown = fallbackText;
    try {
      fallbackPayload = JSON.parse(fallbackText);
    } catch {
      // keep raw text
    }

    if (!fallbackResponse.ok) {
      throw new Error(
        `cv-parse text fallback failed: ${fallbackResponse.status} ${
          typeof fallbackPayload === "string" ? fallbackPayload : JSON.stringify(fallbackPayload)
        }`,
      );
    }

    return fallbackPayload as ParseResponse;
  }

  if (!response.ok) {
    throw new Error(`cv-parse failed: ${response.status} ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return payload as ParseResponse;
}

function scoreContact(parse: ParseResponse, sourceText: string): MetricScore {
  const emails = extractEmails(sourceText).map((item) => item.toLowerCase());
  const phones = extractPhones(sourceText);
  let score = 0;
  const notes: string[] = [];
  if (parse.email && emails.includes(parse.email.toLowerCase())) {
    score += 6;
    notes.push("email matched source");
  } else if (parse.email) {
    notes.push("email extracted but not matched");
  } else {
    notes.push("email missing");
  }

  const parsedPhone = parse.phone ? normalizePhone(parse.phone) : "";
  if (parsedPhone && phones.some((phone) => phone.endsWith(parsedPhone.slice(-10)) || parsedPhone.endsWith(phone.slice(-10)))) {
    score += 6;
    notes.push("phone matched source");
  } else if (parse.phone) {
    notes.push("phone extracted but weak match");
  } else {
    notes.push("phone missing");
  }

  return { score, max: 12, note: notes.join("; "), weak: score < 8 };
}

function scoreHeadline(parse: ParseResponse, sourceText: string): MetricScore {
  const headlineSource = parse.currentTitle || parse.executiveHeadline || parse.professionalSnapshot || "";
  let score = 0;
  const notes: string[] = [];
  if (parse.currentTitle && containsValue(sourceText, parse.currentTitle)) {
    score += 6;
    notes.push("current title grounded in source");
  } else if (parse.currentTitle) {
    score += 3;
    notes.push("current title present but weakly grounded");
  } else {
    notes.push("current title missing");
  }

  if (parse.executiveHeadline) {
    const overlap = overlapRatio(sourceText, parse.executiveHeadline);
    if (overlap >= 0.6) {
      score += 4;
      notes.push("executive headline strongly grounded");
    } else if (overlap >= 0.35) {
      score += 2;
      notes.push("executive headline partially grounded");
    } else {
      notes.push("executive headline feels generic");
    }
  } else if (headlineSource) {
    score += 1;
    notes.push("headline signal only via snapshot");
  } else {
    notes.push("headline missing");
  }

  return { score, max: 10, note: notes.join("; "), weak: score < 6 };
}

function scoreLocation(parse: ParseResponse, sourceText: string): MetricScore {
  const sourceCities = extractSourceCities(sourceText);
  if (!parse.location) {
    return { score: sourceCities.length ? 0 : 4, max: 6, note: sourceCities.length ? "location missing" : "location not obvious in source", weak: sourceCities.length > 0 };
  }
  if (containsValue(sourceText, parse.location)) {
    return { score: 6, max: 6, note: "location matched source" };
  }
  if (sourceCities.some((city) => normalizeText(parse.location).includes(city))) {
    return { score: 4, max: 6, note: "location partially matched source" };
  }
  return { score: 2, max: 6, note: "location extracted but weakly grounded", weak: true };
}

function scoreSalary(parse: ParseResponse, sourceText: string): MetricScore {
  const salarySignals = extractSalarySignals(sourceText);
  if (!salarySignals.length) {
    return {
      score: parse.salarySignal || parse.expectedSalary != null ? 4 : 6,
      max: 6,
      note: parse.salarySignal || parse.expectedSalary != null ? "salary inferred without explicit source signal" : "salary not present in source",
      weak: Boolean(parse.salarySignal || parse.expectedSalary != null),
    };
  }

  if (parse.expectedSalary != null || parse.salarySignal) {
    const salaryText = [parse.salarySignal, parse.expectedSalary != null ? String(parse.expectedSalary) : null].filter(Boolean).join(" ");
    const matched = salarySignals.some((signal) => normalizeText(salaryText).includes(normalizeText(signal)) || normalizeText(signal).includes(normalizeText(salaryText)));
    return {
      score: matched ? 6 : 3,
      max: 6,
      note: matched ? "salary signal grounded in source" : "salary signal present but weak match",
      weak: !matched,
    };
  }

  return { score: 0, max: 6, note: "salary missing despite explicit signal in source", weak: true };
}

function scoreExperience(parse: ParseResponse): MetricScore {
  const items = parse.parsedExperience ?? [];
  if (!items.length) {
    return { score: 0, max: 18, note: "no structured experience extracted", weak: true };
  }
  let score = 0;
  const completeItems = items.filter((item) => item.title && item.company);
  const datedItems = items.filter((item) => item.startDate || item.endDate);
  const richItems = items.filter(
    (item) => (item.highlights?.length ?? 0) > 0 || (item.impactHighlights?.length ?? 0) > 0 || Boolean(item.scope),
  );
  const techItems = items.filter((item) => (item.techStack?.length ?? 0) > 0);

  score += Math.min(6, completeItems.length * 3);
  score += Math.min(4, datedItems.length * 2);
  score += Math.min(5, richItems.length * 2);
  score += Math.min(3, techItems.length * 2);

  const notes = [
    `${items.length} roles extracted`,
    completeItems.length ? `${completeItems.length} title+company pairs` : "missing title/company pairing",
    richItems.length ? `${richItems.length} rich roles with highlights/scope` : "thin responsibilities/impact",
  ];

  return { score, max: 18, note: notes.join("; "), weak: score < 11 };
}

function scoreEducation(parse: ParseResponse): MetricScore {
  const items = parse.parsedEducation ?? [];
  if (!items.length) {
    return { score: 0, max: 10, note: "no structured education extracted", weak: true };
  }
  const completeItems = items.filter((item) => item.degree && item.institution);
  const datedItems = items.filter((item) => item.startDate || item.endDate);
  const confidentItems = items.filter((item) => (item.confidence ?? 0) >= 60);
  const score = Math.min(4, completeItems.length * 3) + Math.min(3, datedItems.length * 2) + Math.min(3, confidentItems.length * 2);
  return {
    score,
    max: 10,
    note: `${items.length} education entries; ${completeItems.length} degree+institution pairs`,
    weak: score < 6,
  };
}

function scoreLanguage(parse: ParseResponse, sourceText: string): MetricScore {
  const sourceHasLanguageSignal = /english|turkish|almanca|german|french|fransızca|turkce|türkçe/i.test(sourceText);
  const items = parse.languageItems ?? [];
  if (!items.length && !parse.languages) {
    return {
      score: sourceHasLanguageSignal ? 0 : 5,
      max: 8,
      note: sourceHasLanguageSignal ? "language signal present in source but not extracted" : "language signal not obvious in source",
      weak: sourceHasLanguageSignal,
    };
  }
  const groundedItems = items.filter((item) => containsValue(sourceText, item.name || null) || containsValue(sourceText, item.level || null));
  const score = Math.min(5, groundedItems.length * 3) + Math.min(3, items.filter((item) => item.level).length * 1.5);
  return {
    score: Math.round(score),
    max: 8,
    note: `${items.length || 1} language signals extracted`,
    weak: Math.round(score) < 5,
  };
}

function scoreSummary(parse: ParseResponse, sourceText: string): MetricScore {
  const summary = parse.summary;
  if (!summary) {
    return { score: 0, max: 15, note: "summary missing", weak: true };
  }
  let score = 0;
  const notes: string[] = [];
  const sentenceCount = summary.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean).length;
  if (sentenceCount >= 2 && sentenceCount <= 5) {
    score += 4;
    notes.push("good summary length");
  } else {
    score += 2;
    notes.push("summary length needs tuning");
  }

  const overlap = overlapRatio(sourceText, summary);
  if (overlap >= 0.6) {
    score += 5;
    notes.push("well grounded in source");
  } else if (overlap >= 0.4) {
    score += 3;
    notes.push("partially grounded in source");
  } else {
    notes.push("summary may be too generic");
  }

  const mentionsTitle = Boolean(parse.currentTitle && normalizeText(summary).includes(normalizeText(parse.currentTitle)));
  const mentionsLocation = Boolean(parse.location && normalizeText(summary).includes(normalizeText(parse.location)));
  const mentionsLanguage = Boolean(parse.languages && normalizeText(summary).includes("english"));
  const detailHits = [mentionsTitle, mentionsLocation, mentionsLanguage].filter(Boolean).length;
  score += Math.min(6, detailHits * 2);

  if (/\b(not found|null|undefined|needs review)\b/i.test(summary)) {
    score = Math.max(0, score - 4);
    notes.push("contains fallback language");
  }

  return { score, max: 15, note: notes.join("; "), weak: score < 9 };
}

function scoreExecutiveHeadline(parse: ParseResponse, sourceText: string): MetricScore {
  if (!parse.executiveHeadline) {
    return { score: 0, max: 7, note: "executive headline missing", weak: true };
  }
  const overlap = overlapRatio(sourceText, parse.executiveHeadline);
  const concise = parse.executiveHeadline.length <= 120;
  const score = (concise ? 2 : 1) + (overlap >= 0.6 ? 5 : overlap >= 0.35 ? 3 : 1);
  return {
    score,
    max: 7,
    note: `${concise ? "concise" : "too long"}; overlap ${formatPercent(overlap)}`,
    weak: score < 4,
  };
}

function scoreStandardizedCv(parse: ParseResponse): MetricScore {
  let score = 0;
  const notes: string[] = [];
  if (parse.executiveHeadline) {
    score += 2;
    notes.push("headline present");
  }
  if (parse.professionalSnapshot) {
    score += 2;
    notes.push("professional snapshot present");
  }
  if ((parse.candidateStrengths?.length ?? 0) >= 3) {
    score += 1;
    notes.push("strengths captured");
  }
  if ((parse.domainFocus?.length ?? 0) >= 2) {
    score += 1;
    notes.push("domain focus captured");
  }
  if ((parse.notableAchievements?.length ?? 0) >= 1) {
    score += 1;
    notes.push("achievements captured");
  }
  if ((parse.parsedExperience?.length ?? 0) >= 1 && (parse.parsedEducation?.length ?? 0) >= 1) {
    score += 1;
    notes.push("core profile sections present");
  }

  return {
    score,
    max: 8,
    note: notes.join("; ") || "brief blocks are too thin",
    weak: score < 5,
  };
}

function inferHallucinationRisk(parse: ParseResponse, sourceText: string) {
  const summaryOverlap = overlapRatio(sourceText, parse.summary);
  const headlineOverlap = overlapRatio(sourceText, parse.executiveHeadline);
  const hasFallbackLanguage =
    /\b(not found|null|undefined)\b/i.test(parse.summary || "") ||
    /\b(not found|null|undefined)\b/i.test(parse.executiveHeadline || "");
  if (hasFallbackLanguage || (parse.summary && summaryOverlap < 0.3) || (parse.executiveHeadline && headlineOverlap < 0.25)) {
    return "high" as const;
  }
  if ((parse.summary && summaryOverlap < 0.45) || (parse.executiveHeadline && headlineOverlap < 0.4)) {
    return "medium" as const;
  }
  return "low" as const;
}

function classifyResult(score: number) {
  if (score >= 80) return "good" as const;
  if (score >= 65) return "usable but thin" as const;
  if (score >= 50) return "needs review" as const;
  return "fails recruiter brief quality" as const;
}

function buildStructuredThinFlags(parse: ParseResponse, metadata: FileMetadata, metrics: Record<MetricKey, MetricScore>) {
  const flags: string[] = [];
  if (metadata.extractionQuality === "thin" || metadata.extractionQuality === "failed") flags.push("text extraction is thin");
  if (metadata.ocrRisk !== "low") flags.push(`ocr risk is ${metadata.ocrRisk}`);
  if (parse.extractionFailureClass) flags.push(`server extraction failure class: ${parse.extractionFailureClass}`);
  if (parse.sourceTextTruncated) flags.push("server extraction truncated the source text");
  if ((parse.parsedExperience?.length ?? 0) === 0) flags.push("experience structure missing");
  if ((parse.parsedEducation?.length ?? 0) === 0) flags.push("education structure missing");
  if ((parse.languageItems?.length ?? 0) === 0 && !parse.languages) flags.push("language structure missing");
  if (metrics.summary.weak) flags.push("summary needs tuning");
  if (metrics.standardizedCv.weak) flags.push("executive brief blocks are thin");
  return Array.from(new Set(flags));
}

function buildMetrics(parse: ParseResponse, sourceText: string) {
  return {
    contact: scoreContact(parse, sourceText),
    headline: scoreHeadline(parse, sourceText),
    location: scoreLocation(parse, sourceText),
    salary: scoreSalary(parse, sourceText),
    experience: scoreExperience(parse),
    education: scoreEducation(parse),
    language: scoreLanguage(parse, sourceText),
    summary: scoreSummary(parse, sourceText),
    executiveHeadline: scoreExecutiveHeadline(parse, sourceText),
    standardizedCv: scoreStandardizedCv(parse),
  } satisfies Record<MetricKey, MetricScore>;
}

function aggregateWeakZones(files: FileBenchmarkResult[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const zone of file.weakZones) {
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([zone, count]) => ({ zone, count }))
    .sort((left, right) => right.count - left.count);
}

function aggregateStructuredThinFlags(files: FileBenchmarkResult[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const flag of file.structuredThinFlags) {
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((left, right) => right.count - left.count);
}

function aggregateExtractionFailures(files: FileBenchmarkResult[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!file.extractionDebug.failureClass) continue;
    counts.set(file.extractionDebug.failureClass, (counts.get(file.extractionDebug.failureClass) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([failureClass, count]) => ({ failureClass, count }))
    .sort((left, right) => right.count - left.count);
}

function aggregateWarnings(files: FileBenchmarkResult[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const warning of file.warnings) {
      counts.set(warning, (counts.get(warning) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([warning, count]) => ({ warning, count }))
    .sort((left, right) => right.count - left.count);
}

function buildFormatBreakdown(files: FileBenchmarkResult[]) {
  const formats = new Map<string, FileBenchmarkResult[]>();
  for (const file of files) {
    const key = file.metadata.format;
    const group = formats.get(key) ?? [];
    group.push(file);
    formats.set(key, group);
  }
  return [...formats.entries()].map(([format, items]) => ({
    format,
    files: items.length,
    averageScore: formatScore(
      Math.round(items.reduce((sum, item) => sum + item.totalScore, 0) / Math.max(items.length, 1)),
      100,
    ),
    highOcrRisk: items.filter((item) => item.metadata.ocrRisk === "high").length,
  }));
}

function buildTuningBacklog(files: FileBenchmarkResult[]): AggregateReport["tuningBacklog"] {
  const weakZones = aggregateWeakZones(files);
  const flags = aggregateStructuredThinFlags(files);
  const warnings = aggregateWarnings(files);
  const extractionFailures = aggregateExtractionFailures(files);
  const backlog: AggregateReport["tuningBacklog"] = [];

  const hasExperienceIssue = weakZones.some((item) => item.zone === "experience");
  const hasSummaryIssue = weakZones.some((item) => item.zone === "summary");
  const hasLanguageIssue = weakZones.some((item) => item.zone === "language");
  const hasEducationIssue = weakZones.some((item) => item.zone === "education");
  const hasExtractionIssue = flags.some((item) => item.flag.includes("text extraction") || item.flag.includes("ocr risk"));
  const hasPdfRuntimeIssue = extractionFailures.some((item) => item.failureClass === "runtime");
  const hasTimeoutIssue = extractionFailures.some((item) => item.failureClass === "timeout");

  if (hasPdfRuntimeIssue) {
    backlog.push({
      title: "Fix production PDF text extraction runtime on Vercel",
      priority: "P0",
      rationale: "Multiple real PDFs failed before model parsing because the current PDF extraction path throws `DOMMatrix is not defined` in production.",
    });
  }

  if (hasTimeoutIssue) {
    backlog.push({
      title: "Add large-document guardrails for DOCX and oversized extracted text",
      priority: "P0",
      rationale: "At least one large real CV timed out before producing a usable parse, so the pipeline needs truncation/streaming safeguards.",
    });
  }

  if (hasExperienceIssue) {
    backlog.push({
      title: "Strengthen experience normalization and impact extraction",
      priority: "P0",
      rationale: "Multiple CVs still produce thin role history, weak date pairing, or insufficient scope/impact detail.",
    });
  }

  if (hasSummaryIssue) {
    backlog.push({
      title: "Tighten recruiter-summary second pass",
      priority: "P0",
      rationale: "Summary quality is still one of the biggest quality separators across real CVs and needs stronger grounding rules.",
    });
  }

  if (hasExtractionIssue) {
    backlog.push({
      title: "Improve extraction fallback for thin PDF/OCR inputs",
      priority: "P0",
      rationale: "A subset of real PDFs still enter the pipeline with weak raw text, which cascades into thin parsing and weak briefs.",
    });
  }

  if (hasLanguageIssue) {
    backlog.push({
      title: "Add stronger language inference and confidence tuning",
      priority: "P1",
      rationale: "Language capture is inconsistent on Turkish and mixed-language CVs and needs explicit extraction plus fallback inference.",
    });
  }

  if (hasEducationIssue) {
    backlog.push({
      title: "Clean education parsing and confidence scoring",
      priority: "P1",
      rationale: "Education extraction still drops useful institution/degree context on weaker layouts.",
    });
  }

  backlog.push({
    title: "Refine standardized CV block priority using benchmark winners and failures",
    priority: "P1",
    rationale: "Executive brief readability should be adjusted based on which outputs felt strongest versus thin in the real corpus.",
  });

  backlog.push({
    title: "Introduce a persistent local benchmark baseline for future model/provider trials",
    priority: "P2",
    rationale: "This corpus should become the fixed decision benchmark when testing new prompts or providers later.",
  });

  return backlog;
}

function buildLiquidVerdict(files: FileBenchmarkResult[]) {
  const averageScore =
    files.reduce((sum, file) => sum + file.totalScore, 0) / Math.max(files.length, 1);
  const highRiskCount = files.filter((file) => file.hallucinationRisk === "high").length;
  const needsReviewCount = files.filter((file) => file.classification !== "good").length;
  const blockingExtractionFailures = files.filter((file) => {
    const failureClass = file.extractionDebug.failureClass;
    if (failureClass !== "runtime" && failureClass !== "timeout" && failureClass !== "empty_text") return false;
    if (!file.extractionDebug.method) return true;
    return file.totalScore < 50;
  }).length;

  if (blockingExtractionFailures >= 3) {
    return {
      decision: "Current scores are dominated by extraction/runtime failures, so Liquid cannot be judged fairly yet.",
      reasons: [
        `${blockingExtractionFailures}/${files.length} files were still materially blocked by extraction/runtime issues before a fair model-quality comparison.`,
        `Average benchmark score landed at ${formatScore(Math.round(averageScore), 100)}, but this is artificially suppressed by upstream pipeline failures.`,
        "The next correct move is fixing PDF/runtime and large-document fallback behavior, then rerunning the same corpus.",
      ],
    };
  }

  if (averageScore >= 72 && highRiskCount <= 2) {
    return {
      decision: "Liquid is good enough to remain primary for now.",
      reasons: [
        `Average benchmark score landed at ${formatScore(Math.round(averageScore), 100)} across the real corpus.`,
        `${needsReviewCount}/${files.length} CVs still need tuning work, but the main gap is prompt/enrichment quality rather than a total model failure.`,
        "The next highest-value move is prompt/schema tuning before changing providers.",
      ],
    };
  }

  return {
    decision: "Liquid is usable, but the corpus shows enough weakness that provider comparison should stay on the table.",
    reasons: [
      `Average benchmark score landed at ${formatScore(Math.round(averageScore), 100)}.`,
      `${highRiskCount} files still showed high hallucination risk or weak grounding.`,
      "Prompt/schema tuning should happen first, but a stronger provider benchmark is still justified afterward.",
    ],
  };
}

function renderMarkdown(report: AggregateReport) {
  const topWeakZones = report.recurringWeakZones.slice(0, 5);
  const topFlags = report.recurringStructuredThinFlags.slice(0, 5);
  const topExtractionFailures = report.recurringExtractionFailures.slice(0, 5);
  const topWarnings = report.recurringWarnings.slice(0, 5);
  const rows = report.files
    .map((file) => {
      const weakZones = file.weakZones.length ? file.weakZones.join(", ") : "none";
      return `| ${file.metadata.fileName} | ${file.metadata.format} | ${file.metadata.extractionQuality} | ${file.extractionDebug.method ?? "n/a"} | ${file.metadata.languageProfile} | ${formatScore(file.totalScore, file.totalMax)} | ${file.classification} | ${file.hallucinationRisk} | ${weakZones} |`;
    })
    .join("\n");

  const backlog = report.tuningBacklog
    .map((item) => `- \`${item.priority}\` ${item.title}: ${item.rationale}`)
    .join("\n");

  return [
    "# RecruitFlow Real CV Benchmark Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Base URL: ${report.baseUrl}`,
    `Corpus file: ${report.corpusPath}`,
    "",
    "## Summary",
    `- Files benchmarked: ${report.totals.files}`,
    `- Average score: ${report.totals.averageScore}`,
    `- Good: ${report.totals.classifications.good}`,
    `- Usable but thin: ${report.totals.classifications["usable but thin"]}`,
    `- Needs review: ${report.totals.classifications["needs review"]}`,
    `- Fails recruiter brief quality: ${report.totals.classifications["fails recruiter brief quality"]}`,
    "",
    "## Liquid Verdict",
    `- ${report.liquidVerdict.decision}`,
    ...report.liquidVerdict.reasons.map((reason) => `- ${reason}`),
    "",
    "## CV Scores",
    "| File | Format | Extraction | Server extractor | Language | Score | Classification | Hallucination risk | Weak zones |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    rows,
    "",
    "## Recurring Weak Zones",
    ...(topWeakZones.length ? topWeakZones.map((item) => `- ${item.zone}: ${item.count}`) : ["- none"]),
    "",
    "## Recurring Structured-Thin Flags",
    ...(topFlags.length ? topFlags.map((item) => `- ${item.flag}: ${item.count}`) : ["- none"]),
    "",
    "## Recurring Extraction Failures",
    ...(topExtractionFailures.length ? topExtractionFailures.map((item) => `- ${item.failureClass}: ${item.count}`) : ["- none"]),
    "",
    "## Recurring Warnings",
    ...(topWarnings.length ? topWarnings.map((item) => `- ${item.warning}: ${item.count}`) : ["- none"]),
    "",
    "## Format Breakdown",
    ...report.formatBreakdown.map(
      (item) => `- ${item.format}: ${item.files} files, average ${item.averageScore}, high OCR risk ${item.highOcrRisk}`,
    ),
    "",
    "## Tuning Backlog",
    backlog,
    "",
  ].join("\n");
}

async function loadCorpus() {
  const corpusPath = process.env.RECRUITFLOW_BENCHMARK_CORPUS
    ? path.resolve(process.env.RECRUITFLOW_BENCHMARK_CORPUS)
    : DEFAULT_CORPUS_PATH;
  const raw = await fs.readFile(corpusPath, "utf8");
  const parsed = JSON.parse(raw) as CorpusConfig;
  if (!parsed.files?.length) {
    throw new Error(`Corpus file has no files: ${corpusPath}`);
  }
  return { corpusPath, config: parsed };
}

async function benchmarkOne(baseUrl: string, token: string, file: CorpusFileConfig): Promise<FileBenchmarkResult> {
  const buffer = await fs.readFile(file.path);
  const fileName = path.basename(file.path);
  const format = detectFormat(file.path);
  let extractedText = "";
  try {
    if (format === "pdf") {
      extractedText = await extractTextFromPdf(buffer);
    } else if (format === "docx") {
      extractedText = await extractTextFromDocx(buffer);
    }
  } catch {
    extractedText = "";
  }

  const metadata = inferMetadata(file.path, buffer.byteLength, extractedText, file.languageProfile);
  let parsed: ParseResponse;
  try {
    parsed = await parseFile(baseUrl, token, file.path, buffer, extractedText);
  } catch (error) {
    const emptyMetrics = {
      contact: { score: 0, max: 12, note: "parse failed", weak: true },
      headline: { score: 0, max: 10, note: "parse failed", weak: true },
      location: { score: 0, max: 6, note: "parse failed", weak: true },
      salary: { score: 0, max: 6, note: "parse failed", weak: true },
      experience: { score: 0, max: 18, note: "parse failed", weak: true },
      education: { score: 0, max: 10, note: "parse failed", weak: true },
      language: { score: 0, max: 8, note: "parse failed", weak: true },
      summary: { score: 0, max: 15, note: "parse failed", weak: true },
      executiveHeadline: { score: 0, max: 7, note: "parse failed", weak: true },
      standardizedCv: { score: 0, max: 8, note: "parse failed", weak: true },
    } satisfies Record<MetricKey, MetricScore>;
    return {
      filePath: file.path,
      metadata,
      parseProvider: null,
      parseStatus: "failed",
      parseConfidence: 0,
      parseReviewRequired: true,
      warnings: [error instanceof Error ? error.message : "parse failed"],
      metrics: emptyMetrics,
      totalScore: 0,
      totalMax: 100,
      classification: "fails recruiter brief quality",
      weakZones: Object.keys(emptyMetrics) as MetricKey[],
      hallucinationRisk: "high",
      structuredThinFlags: buildStructuredThinFlags({}, metadata, emptyMetrics),
      extractionDebug: {
        method: null,
        fallbackUsed: false,
        failureClass: null,
        sourceTextLength: null,
        sourceTextTruncated: false,
      },
      output: {
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        currentTitle: null,
        location: null,
        summary: null,
        executiveHeadline: null,
        professionalSnapshot: null,
        domainFocus: null,
        candidateStrengths: null,
        candidateRisks: null,
        notableAchievements: null,
        languages: null,
        languageItems: null,
        salarySignal: null,
        standardizedProfile: null,
      },
    };
  }
  const metrics = buildMetrics(parsed, extractedText);
  const totalScore = Object.values(metrics).reduce((sum, metric) => sum + metric.score, 0);
  const totalMax = Object.values(metrics).reduce((sum, metric) => sum + metric.max, 0);
  const weakZones = (Object.entries(metrics) as Array<[MetricKey, MetricScore]>)
    .filter(([, metric]) => metric.weak)
    .map(([key]) => key);
  const structuredThinFlags = buildStructuredThinFlags(parsed, metadata, metrics);
  const hallucinationRisk = inferHallucinationRisk(parsed, extractedText);

  return {
    filePath: file.path,
    metadata,
    parseProvider: parsed.parseProvider ?? null,
    parseStatus: parsed.parseStatus ?? null,
    parseConfidence: parsed.parseConfidence ?? null,
    parseReviewRequired: Boolean(parsed.parseReviewRequired),
    warnings: pickDefined(parsed.warnings, []),
    metrics,
    totalScore,
    totalMax,
    classification: classifyResult(Math.round((totalScore / Math.max(totalMax, 1)) * 100)),
    weakZones,
    hallucinationRisk,
    structuredThinFlags,
    extractionDebug: {
      method: parsed.extractionMethod ?? null,
      fallbackUsed: Boolean(parsed.extractionFallbackUsed),
      failureClass: parsed.extractionFailureClass ?? null,
      sourceTextLength: parsed.sourceTextLength ?? null,
      sourceTextTruncated: Boolean(parsed.sourceTextTruncated),
    },
    output: {
      firstName: parsed.firstName ?? null,
      lastName: parsed.lastName ?? null,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      currentTitle: parsed.currentTitle ?? null,
      location: parsed.location ?? null,
      summary: parsed.summary ?? null,
      executiveHeadline: parsed.executiveHeadline ?? null,
      professionalSnapshot: parsed.professionalSnapshot ?? null,
      domainFocus: parsed.domainFocus ?? null,
      candidateStrengths: parsed.candidateStrengths ?? null,
      candidateRisks: parsed.candidateRisks ?? null,
      notableAchievements: parsed.notableAchievements ?? null,
      languages: parsed.languages ?? null,
      languageItems: parsed.languageItems ?? null,
      salarySignal: parsed.salarySignal ?? null,
      standardizedProfile: parsed.standardizedProfile ?? null,
    },
  };
}

async function main() {
  const { corpusPath, config } = await loadCorpus();
  const baseUrl = (config.baseUrl || process.env.RECRUITFLOW_CV_PARSE_BASE_URL || process.env.PUBLIC_APP_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const vendorEmail = config.vendorAuth?.email || DEFAULT_VENDOR_EMAIL;
  const vendorPassword =
    config.vendorAuth?.password ||
    (config.vendorAuth?.passwordEnv ? process.env[config.vendorAuth.passwordEnv] : undefined) ||
    DEFAULT_VENDOR_PASSWORD;

  if (!vendorEmail || !vendorPassword) {
    throw new Error("Vendor credentials are required for the local benchmark corpus.");
  }

  const token = await login(baseUrl, vendorEmail, vendorPassword);
  const results: FileBenchmarkResult[] = [];
  for (const [index, file] of config.files.entries()) {
    console.log(`[benchmark] ${index + 1}/${config.files.length} ${path.basename(file.path)}`);
    results.push(await benchmarkOne(baseUrl, token, file));
  }

  const classifications = {
    good: results.filter((item) => item.classification === "good").length,
    "usable but thin": results.filter((item) => item.classification === "usable but thin").length,
    "needs review": results.filter((item) => item.classification === "needs review").length,
    "fails recruiter brief quality": results.filter((item) => item.classification === "fails recruiter brief quality").length,
  } as Record<FileBenchmarkResult["classification"], number>;

  const report: AggregateReport = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    corpusPath,
    files: results,
    totals: {
      files: results.length,
      averageScore: formatScore(
        Math.round(results.reduce((sum, item) => sum + item.totalScore, 0) / Math.max(results.length, 1)),
        100,
      ),
      classifications,
    },
    recurringWeakZones: aggregateWeakZones(results),
    recurringStructuredThinFlags: aggregateStructuredThinFlags(results),
    recurringExtractionFailures: aggregateExtractionFailures(results),
    recurringWarnings: aggregateWarnings(results),
    formatBreakdown: buildFormatBreakdown(results),
    liquidVerdict: buildLiquidVerdict(results),
    tuningBacklog: buildTuningBacklog(results),
  };

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(REPORTS_DIR, `recruitflow-real-cv-benchmark-${stamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `recruitflow-real-cv-benchmark-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, renderMarkdown(report));

  console.log(
    JSON.stringify(
      {
        result: "ok",
        files: results.length,
        baseUrl,
        jsonReport: jsonPath,
        markdownReport: mdPath,
        averageScore: report.totals.averageScore,
        liquidVerdict: report.liquidVerdict.decision,
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
