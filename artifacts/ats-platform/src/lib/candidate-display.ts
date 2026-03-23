const TURKISH_LIRA_FORMATTER = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

export function formatTurkishLira(amount?: number | null) {
  if (amount == null) return "Not provided";
  return TURKISH_LIRA_FORMATTER.format(amount);
}

export function getCompanyDisplayName(companyName?: string | null, fallback?: string | null) {
  const trimmedCompany = companyName?.trim();
  if (trimmedCompany) return trimmedCompany;

  const trimmedFallback = fallback?.trim();
  if (trimmedFallback) return trimmedFallback;

  return "Workspace";
}

export function requiresStatusReason(status?: string | null) {
  return status === "interview" || status === "rejected";
}

export function getStatusReasonTitle(status?: string | null) {
  if (status === "rejected") return "Rejection reason";
  return "Interview note";
}

export function getStatusReasonDescription(status?: string | null) {
  if (status === "rejected") {
    return "Add a concise professional reason so the rejection is documented for the full review team.";
  }

  return "Add a short professional note so the interview step is clear to the client and admin teams.";
}

function normalizeTagValue(tag: string) {
  return tag.trim().replace(/\s+/g, " ");
}

export function parseCandidateTags(tags?: string | null) {
  const values = tags
    ? tags
        .split(",")
        .map((tag) => normalizeTagValue(tag))
        .filter(Boolean)
    : [];

  let englishLevel: string | null = null;
  const visibleTags: string[] = [];

  for (const tag of values) {
    const match = tag.match(/^english(?:\s+level)?\s*:\s*(.+)$/i);
    if (match && !englishLevel) {
      englishLevel = match[1].trim();
      continue;
    }

    visibleTags.push(tag);
  }

  return { visibleTags, englishLevel };
}

export function composeCandidateTags(tags?: string | null, englishLevel?: string | null) {
  const { visibleTags } = parseCandidateTags(tags);
  const normalizedEnglishLevel = englishLevel?.trim();

  if (normalizedEnglishLevel) {
    visibleTags.push(`English level: ${normalizedEnglishLevel}`);
  }

  return Array.from(new Set(visibleTags)).join(", ");
}

type CandidateIntelligenceInput = {
  phone?: string | null;
  expectedSalary?: number | null;
  parseConfidence?: number | null;
  parseReviewRequired?: boolean | null;
  parsedSkills?: string[] | null;
  parsedExperience?: unknown[] | null;
  parsedEducation?: unknown[] | null;
  languages?: string | null;
  summary?: string | null;
};

export function getCandidateCompleteness(input: CandidateIntelligenceInput) {
  const checks = [
    Boolean(input.phone),
    input.expectedSalary != null,
    Boolean(input.languages?.trim()),
    Boolean(input.summary?.trim()),
    Boolean(input.parsedSkills?.length),
    Boolean(input.parsedExperience?.length),
    Boolean(input.parsedEducation?.length),
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
}

export function getCandidateDecisionGuidance(input: CandidateIntelligenceInput) {
  const completeness = getCandidateCompleteness(input);
  const confidence = input.parseConfidence ?? 0;

  if (!input.phone || input.expectedSalary == null) {
    return {
      label: "Hold for profile completion",
      tone: "amber" as const,
      body: "Key contact or compensation fields are still missing. Finalize the profile before pushing the candidate deeper into the pipeline.",
    };
  }

  if (input.parseReviewRequired || confidence < 70 || !input.parsedExperience?.length) {
    return {
      label: "Normalize before approval",
      tone: "amber" as const,
      body: "The profile has enough signal to continue, but the admin team should clean up structured experience and normalize the final brief first.",
    };
  }

  if (completeness >= 85 && confidence >= 80) {
    return {
      label: "Ready for client-facing review",
      tone: "emerald" as const,
      body: "The candidate record is complete, the parse quality is strong, and the profile is ready for fast stakeholder review.",
    };
  }

  return {
    label: "Good profile, quick admin pass recommended",
    tone: "blue" as const,
    body: "The record looks solid overall. A short admin pass will make the handoff cleaner and more persuasive.",
  };
}
