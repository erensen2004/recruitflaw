import type { Candidate, CandidateParsedEducation, CandidateParsedExperience } from "@workspace/api-client-react";
import { formatTurkishLira, getCandidateExecutiveBrief, parseCandidateTags } from "@/lib/candidate-display";

function sectionText(title: string, lines: string[]) {
  const body = lines.filter(Boolean).join("\n");
  if (!body) return "";
  return `${title}\n${body}`;
}

function experienceToLines(experience: CandidateParsedExperience[]) {
  return experience.flatMap((item) => {
    const header = [item.title, item.company].filter(Boolean).join(" @ ");
    const dates = [item.startDate, item.endDate].filter(Boolean).join(" - ");
    const highlights = item.highlights?.filter(Boolean).map((line) => `• ${line}`) ?? [];
    return [header, dates, ...highlights].filter(Boolean);
  });
}

function educationToLines(education: CandidateParsedEducation[]) {
  return education.map((item) =>
    [item.degree, item.fieldOfStudy, item.institution, [item.startDate, item.endDate].filter(Boolean).join(" - ")]
      .filter(Boolean)
      .join(" | "),
  );
}

async function buildStandardizedCandidatePdf(candidate: Candidate) {
  const { englishLevel } = parseCandidateTags(candidate.tags);
  const brief = getCandidateExecutiveBrief(candidate);
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const maxWidth = 515;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 54;

  const ensurePage = (neededHeight: number) => {
    if (y + neededHeight <= pageHeight - 48) return;
    doc.addPage();
    y = 54;
  };

  const writeBlock = (title: string, content: string[], opts?: { compact?: boolean }) => {
    const lines = content.filter(Boolean);
    if (!lines.length) return;
    const titleHeight = 18;
    const split = doc.splitTextToSize(lines.join("\n"), maxWidth) as string[];
    ensurePage(titleHeight + split.length * 15 + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(opts?.compact ? 12 : 13);
    doc.text(title, 48, y);
    y += titleHeight;
    doc.setFont("helvetica", "normal");
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
    doc.setFont("helvetica", "bold");
    doc.setFontSize(opts?.compact ? 12 : 13);
    doc.text(title, 48, y);
    y += titleHeight;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(splitLines, 48, y);
    y += splitLines.length * 15 + 10;
  };

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(40, 34, 515, 108, 18, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("RecruitFlow Executive Candidate Brief", 58, 58);
  doc.setFontSize(23);
  doc.text(`${candidate.firstName} ${candidate.lastName}`, 58, 88);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(226, 232, 240);
  doc.text(candidate.currentTitle || candidate.roleTitle || "Normalized candidate profile", 58, 108, { maxWidth: 320 });
  doc.setFontSize(9.5);
  doc.text(candidate.roleTitle ? `Submitted for ${candidate.roleTitle}` : "Prepared from the parsed candidate profile", 58, 124, { maxWidth: 320 });
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(422, 52, 116, 64, 14, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(`${brief.fitScore}`, 438, 79);
  doc.setFontSize(9.5);
  doc.text(brief.fitLabel, 438, 94, { maxWidth: 82 });

  doc.setTextColor(15, 23, 42);
  y = 166;

  const meta = [
    candidate.location || null,
    candidate.email,
    candidate.phone || null,
    candidate.vendorCompanyName ? `Submitted by ${candidate.vendorCompanyName}` : null,
  ].filter(Boolean);

  if (meta.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(meta.join("  •  "), 48, y, { maxWidth });
    y += 24;
  }

  const reviewLine = [
    candidate.parseConfidence != null ? `Parse confidence ${candidate.parseConfidence}%` : null,
    candidate.parseReviewRequired ? "Admin reviewed output recommended" : "Ready for client review",
    candidate.expectedSalary != null ? `Expected salary ${formatTurkishLira(candidate.expectedSalary)}` : null,
  ].filter(Boolean);
  if (reviewLine.length) {
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(48, y - 12, 515, 30, 12, 12, "F");
    doc.setTextColor(30, 64, 175);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(reviewLine.join("  •  "), 60, y + 6, { maxWidth: 490 });
    doc.setTextColor(15, 23, 42);
    y += 34;
  }

  writeBlock("Executive Summary", [
    brief.fitSummary,
    candidate.summary || candidate.standardizedProfile || "Admin-normalized summary not available yet.",
  ]);
  writeBulletBlock("Top Strengths", brief.strengths, { compact: true });
  writeBulletBlock("Risk Flags", brief.riskFlags, { compact: true });
  writeBulletBlock("Normalization Notes", brief.normalizationNotes, { compact: true });
  writeBlock("Key Skills", [candidate.parsedSkills.length ? candidate.parsedSkills.join(", ") : candidate.tags || "Skills not available"], { compact: true });
  writeBlock("Experience", experienceToLines(candidate.parsedExperience));
  writeBlock("Education", educationToLines(candidate.parsedEducation));
  writeBlock("Additional Details", [
    candidate.languages ? `Languages: ${candidate.languages}` : "",
    englishLevel ? `English level: ${englishLevel}` : "",
    candidate.yearsExperience != null ? `Years of experience: ${candidate.yearsExperience}` : "",
    candidate.expectedSalary != null ? `Expected salary: ${formatTurkishLira(candidate.expectedSalary)}` : "",
    brief.adminReady ? "Admin-ready: yes" : "Admin-ready: needs review",
  ]);

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
    throw new Error("The preview could not be opened. Please allow pop-ups and try again.");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportStandardizedCandidatePdf(candidate: Candidate) {
  const doc = await buildStandardizedCandidatePdf(candidate);
  const safeName = getSafeCandidateFileName(candidate);
  doc.save(`${safeName}_recruitflow_standardized_cv.pdf`);
}
