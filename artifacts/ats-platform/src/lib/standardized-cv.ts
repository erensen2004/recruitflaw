import type { Candidate, CandidateParsedEducation, CandidateParsedExperience } from "@workspace/api-client-react";

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

export async function exportStandardizedCandidatePdf(candidate: Candidate) {
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(`${candidate.firstName} ${candidate.lastName}`, 48, y);
  y += 24;

  const meta = [
    candidate.currentTitle || null,
    candidate.location || null,
    candidate.email,
    candidate.phone || null,
  ].filter(Boolean);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(meta.join("  •  "), 48, y, { maxWidth });
  y += 24;

  writeBlock("Professional Summary", [candidate.summary || candidate.standardizedProfile || "Summary not available"]);
  writeBlock("Key Skills", [candidate.parsedSkills.length ? candidate.parsedSkills.join(", ") : candidate.tags || "Skills not available"], { compact: true });
  writeBlock("Experience", experienceToLines(candidate.parsedExperience));
  writeBlock("Education", educationToLines(candidate.parsedEducation));
  writeBlock("Additional Details", [
    candidate.languages ? `Languages: ${candidate.languages}` : "",
    candidate.yearsExperience != null ? `Years of experience: ${candidate.yearsExperience}` : "",
    candidate.expectedSalary != null ? `Expected salary: $${candidate.expectedSalary.toLocaleString()}` : "",
  ]);

  const safeName = `${candidate.firstName}_${candidate.lastName}`.replace(/\s+/g, "_");
  doc.save(`${safeName}_recruitflow_standardized_cv.pdf`);
}
