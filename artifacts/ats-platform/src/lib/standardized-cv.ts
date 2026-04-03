import type { Candidate, CandidateParsedEducation } from "@workspace/api-client-react";
import { formatTurkishLira, getCandidateExecutiveBrief, parseCandidateTags } from "@/lib/candidate-display";
import regularFontUrl from "pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url";
import boldFontUrl from "pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url";

type PdfFontPayload = {
  regular: string;
  bold: string;
};

let pdfFontPayloadPromise: Promise<PdfFontPayload> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

async function getPdfFontPayload(): Promise<PdfFontPayload> {
  pdfFontPayloadPromise ??= (async () => {
    const [regularBuffer, boldBuffer] = await Promise.all([
      fetch(regularFontUrl).then(async (response) => {
        if (!response.ok) throw new Error("Standardized CV font could not be loaded.");
        return response.arrayBuffer();
      }),
      fetch(boldFontUrl).then(async (response) => {
        if (!response.ok) throw new Error("Standardized CV bold font could not be loaded.");
        return response.arrayBuffer();
      }),
    ]);

    return {
      regular: arrayBufferToBase64(regularBuffer),
      bold: arrayBufferToBase64(boldBuffer),
    };
  })();

  return pdfFontPayloadPromise;
}

async function ensurePdfFonts(doc: any) {
  const payload = await getPdfFontPayload();
  doc.addFileToVFS("LiberationSans-Regular.ttf", payload.regular);
  doc.addFileToVFS("LiberationSans-Bold.ttf", payload.bold);
  doc.addFont("LiberationSans-Regular.ttf", "LiberationSans", "normal");
  doc.addFont("LiberationSans-Bold.ttf", "LiberationSans", "bold");
  doc.setFont("LiberationSans", "normal");
}

function educationToLines(education: CandidateParsedEducation[]) {
  return education.map((item) =>
    [item.degree, item.fieldOfStudy, item.institution, [item.startDate, item.endDate].filter(Boolean).join(" - ")]
      .filter(Boolean)
      .join(" | "),
  );
}

function dedupe(values: Array<string | null | undefined>, limit = 8) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).slice(0, limit);
}

async function buildStandardizedCandidatePdf(candidate: Candidate) {
  const { englishLevel } = parseCandidateTags(candidate.tags);
  const brief = getCandidateExecutiveBrief(candidate);
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  await ensurePdfFonts(doc);

  const maxWidth = 505;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 54;

  const ensurePage = (neededHeight: number) => {
    if (y + neededHeight <= pageHeight - 48) return;
    doc.addPage();
    doc.setFont("LiberationSans", "normal");
    y = 54;
  };

  const startSecondPage = () => {
    doc.addPage();
    doc.setFont("LiberationSans", "normal");
    y = 54;
  };

  const writeBlock = (title: string, content: string[], opts?: { compact?: boolean }) => {
    const lines = content.filter(Boolean);
    if (!lines.length) return;
    const titleHeight = 18;
    const split = doc.splitTextToSize(lines.join("\n"), maxWidth) as string[];
    ensurePage(titleHeight + split.length * 15 + 14);
    doc.setFont("LiberationSans", "bold");
    doc.setFontSize(opts?.compact ? 12 : 13);
    doc.text(title, 48, y);
    y += titleHeight;
    doc.setFont("LiberationSans", "normal");
    doc.setFontSize(10.5);
    doc.text(split, 48, y);
    y += split.length * 15 + 10;
  };

  const writeBulletBlock = (title: string, items: string[], opts?: { compact?: boolean }) => {
    const lines = items.filter(Boolean);
    if (!lines.length) return;
    const titleHeight = 18;
    const splitLines = lines.flatMap((item) => doc.splitTextToSize(`• ${item}`, maxWidth) as string[]);
    ensurePage(titleHeight + splitLines.length * 15 + 14);
    doc.setFont("LiberationSans", "bold");
    doc.setFontSize(opts?.compact ? 12 : 13);
    doc.text(title, 48, y);
    y += titleHeight;
    doc.setFont("LiberationSans", "normal");
    doc.setFontSize(10.5);
    doc.text(splitLines, 48, y);
    y += splitLines.length * 15 + 10;
  };

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(40, 34, 515, 116, 18, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("LiberationSans", "bold");
  doc.setFontSize(11);
  doc.text("RecruitFlow Executive Candidate Brief", 58, 58);
  doc.setFontSize(22);
  doc.text(`${candidate.firstName} ${candidate.lastName}`, 58, 88);
  doc.setFont("LiberationSans", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(226, 232, 240);
  doc.text(brief.headline || candidate.currentTitle || candidate.roleTitle || "Candidate summary", 58, 108, { maxWidth: 320 });
  doc.setFontSize(9.5);
  doc.text(candidate.roleTitle ? `Prepared for the ${candidate.roleTitle} role` : "Prepared from the structured candidate profile", 58, 126, {
    maxWidth: 320,
  });
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(422, 52, 116, 72, 14, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("LiberationSans", "bold");
  doc.setFontSize(20);
  doc.text(`${brief.fitScore}`, 438, 79);
  doc.setFontSize(9.5);
  doc.text(brief.fitLabel, 438, 95, { maxWidth: 84 });

  doc.setTextColor(15, 23, 42);
  y = 174;

  const meta = dedupe([
    candidate.location || null,
    candidate.email,
    candidate.phone || null,
    candidate.vendorCompanyName ? `Submitted by ${candidate.vendorCompanyName}` : null,
  ], 5);

  if (meta.length) {
    doc.setFont("LiberationSans", "normal");
    doc.setFontSize(10.5);
    doc.text(meta.join("  •  "), 48, y, { maxWidth });
    y += 24;
  }

  const reviewLine = dedupe([
    candidate.parseConfidence != null ? `Parse confidence ${candidate.parseConfidence}%` : null,
    brief.fitSummary,
    candidate.expectedSalary != null ? `Expected compensation ${formatTurkishLira(candidate.expectedSalary)}` : null,
  ], 3);

  if (reviewLine.length) {
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(48, y - 12, 515, 38, 12, 12, "F");
    doc.setTextColor(30, 64, 175);
    doc.setFont("LiberationSans", "bold");
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(reviewLine.join("  •  "), 490), 60, y + 4);
    doc.setTextColor(15, 23, 42);
    y += 42;
  }

  writeBlock("Executive Headline", [brief.headline], { compact: true });
  writeBlock("Professional Snapshot", [brief.professionalSnapshot]);
  writeBulletBlock("Top Strengths", brief.strengths, { compact: true });
  writeBulletBlock("Domain Focus", brief.domainFocus, { compact: true });
  writeBulletBlock("Notable Achievements", brief.notableAchievements, { compact: true });

  startSecondPage();

  writeBulletBlock("Experience Highlights", brief.experienceHighlights);

  writeBlock(
    "Core Experience Timeline",
    brief.coreExperience.flatMap((item) => {
      const lines = [item.header, item.timeline, item.scope];
      if (item.techStack.length) {
        lines.push(`Tech stack: ${item.techStack.join(", ")}`);
      }
      return lines.filter((line): line is string => Boolean(line));
    }),
  );

  writeBlock("Education & Languages", [
    ...educationToLines(candidate.parsedEducation),
    candidate.languageItems?.length
      ? `Languages: ${candidate.languageItems
          .map((item) => [item.name, item.level].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(", ")}`
      : candidate.languages
        ? `Languages: ${candidate.languages}`
        : "",
    englishLevel ? `English level: ${englishLevel}` : "",
  ]);

  writeBlock("Compensation / Location / Work Model", dedupe([
    brief.locationFlexibility ? `Location: ${brief.locationFlexibility}` : candidate.location ? `Location: ${candidate.location}` : null,
    brief.workModel ? `Work model: ${brief.workModel}` : null,
    brief.salarySignal ? brief.salarySignal : candidate.expectedSalary != null ? `Expected compensation: ${formatTurkishLira(candidate.expectedSalary)}` : null,
    candidate.yearsExperience != null ? `Total experience: ${candidate.yearsExperience} years` : null,
  ], 4));

  writeBulletBlock("Open Points", brief.openPoints, { compact: true });

  if (candidate.fieldConfidence) {
    writeBlock(
      "Profile Confidence",
      [
        [
          candidate.fieldConfidence.contact != null ? `Contact ${candidate.fieldConfidence.contact}%` : null,
          candidate.fieldConfidence.experience != null ? `Experience ${candidate.fieldConfidence.experience}%` : null,
          candidate.fieldConfidence.education != null ? `Education ${candidate.fieldConfidence.education}%` : null,
          candidate.fieldConfidence.languages != null ? `Languages ${candidate.fieldConfidence.languages}%` : null,
          candidate.fieldConfidence.compensation != null ? `Compensation ${candidate.fieldConfidence.compensation}%` : null,
          candidate.fieldConfidence.summary != null ? `Brief ${candidate.fieldConfidence.summary}%` : null,
        ]
          .filter(Boolean)
          .join("  •  "),
      ],
      { compact: true },
    );
  }

  return doc;
}

function getSafeCandidateFileName(candidate: Candidate) {
  return `${candidate.firstName}_${candidate.lastName}`.replace(/\s+/g, "_");
}

export async function previewStandardizedCandidatePdf(candidate: Candidate) {
  const doc = await buildStandardizedCandidatePdf(candidate);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error("Preview could not be opened. Please check your pop-up settings and try again.");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportStandardizedCandidatePdf(candidate: Candidate) {
  const doc = await buildStandardizedCandidatePdf(candidate);
  const safeName = getSafeCandidateFileName(candidate);
  doc.save(`${safeName}_recruitflow_standardized_cv.pdf`);
}
