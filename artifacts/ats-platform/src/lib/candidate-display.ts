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
  email?: string | null;
  currentTitle?: string | null;
  roleTitle?: string | null;
  location?: string | null;
  phone?: string | null;
  expectedSalary?: number | null;
  yearsExperience?: number | null;
  parseConfidence?: number | null;
  parseReviewRequired?: boolean | null;
  parsedSkills?: string[] | null;
  parsedExperience?: unknown[] | null;
  parsedEducation?: unknown[] | null;
  languages?: string | null;
  summary?: string | null;
  standardizedProfile?: string | null;
  tags?: string | null;
};

export function getCandidateLanguageReadiness(input: CandidateIntelligenceInput) {
  const { englishLevel } = parseCandidateTags(input.tags);
  const languagesText = input.languages?.trim();

  return {
    englishLevel,
    languageLabel: englishLevel ?? languagesText ?? "Not provided",
    languageReady: Boolean(englishLevel || languagesText),
  };
}

export function getCandidateCompleteness(input: CandidateIntelligenceInput) {
  const checks = [
    Boolean(input.email?.trim()),
    Boolean(input.currentTitle?.trim()),
    Boolean(input.location?.trim()),
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

export function getCandidateReadinessSnapshot(input: CandidateIntelligenceInput) {
  const completeness = getCandidateCompleteness(input);
  const confidence = input.parseConfidence ?? 0;
  const { englishLevel, languageLabel, languageReady } = getCandidateLanguageReadiness(input);
  const salaryLabel = formatTurkishLira(input.expectedSalary);
  const compensationReady = input.expectedSalary != null;
  const experienceReady = Boolean(input.parsedExperience?.length);
  const educationReady = Boolean(input.parsedEducation?.length);
  const contactReady = Boolean(input.email?.trim() && input.phone);
  const riskFlags = [
    !input.email?.trim() ? "Email address is missing" : null,
    !contactReady ? "Contact details need review" : null,
    !input.currentTitle?.trim() ? "Current title is missing" : null,
    !input.location?.trim() ? "Location still needs review" : null,
    !compensationReady ? "Compensation still missing" : null,
    !languageReady ? "Language coverage still unclear" : null,
    !experienceReady ? "Experience timeline is thin" : null,
    !educationReady ? "Education details are thin" : null,
    input.parseReviewRequired ? "Admin normalization required" : null,
    confidence > 0 && confidence < 70 ? "Parse confidence is below the preferred review threshold" : null,
  ].filter((item): item is string => Boolean(item));

  const riskLevel = !contactReady || !compensationReady || !experienceReady || confidence < 70 || input.parseReviewRequired
    ? riskFlags.length >= 4
      ? "high"
      : "medium"
    : "low";

  const readinessLabel =
    riskLevel === "low" && completeness >= 85 && confidence >= 80 && compensationReady && languageReady
      ? "Ready for client review"
      : riskLevel === "medium"
        ? "Needs admin pass"
        : "Hold for normalization";

  const readinessTone: "emerald" | "amber" | "rose" =
    riskLevel === "low" ? "emerald" : riskLevel === "medium" ? "amber" : "rose";

  const decisionSummary =
    riskLevel === "low"
      ? "The candidate is complete enough for a fast handoff and should read cleanly to the client."
      : riskLevel === "medium"
        ? "The record has useful signal, but a short admin pass will improve the handoff and reduce review friction."
        : "Critical fields are still missing, so the record should stay in admin review before it reaches the client.";

  const nextAction =
    !input.email?.trim()
      ? "Confirm email before client handoff."
      : !input.phone
        ? "Confirm phone number before client handoff."
        : !contactReady
      ? "Confirm contact details before outreach."
      : !input.currentTitle?.trim()
        ? "Capture the current title before publish."
        : !input.location?.trim()
          ? "Confirm location before publish."
          : !compensationReady
            ? "Capture compensation expectations before publish."
            : !languageReady
              ? "Record language proficiency before final review."
              : input.parseReviewRequired
                ? "Normalize the profile and approve it from admin."
                : "The profile is ready for a final client-facing pass.";

  return {
    completeness,
    confidence,
    englishLevel,
    languageLabel,
    languageReady,
    salaryLabel,
    compensationReady,
    experienceReady,
    educationReady,
    contactReady,
    riskFlags,
    riskLevel,
    readinessLabel,
    readinessTone,
    decisionSummary,
    nextAction,
  };
}

type CandidateExecutiveBrief = {
  fitScore: number;
  fitLabel: string;
  fitSummary: string;
  strengths: string[];
  riskFlags: string[];
  normalizationNotes: string[];
  adminReady: boolean;
  spotlight: string;
};

function normalizeKeywordSet(value?: string | null) {
  return new Set(
    (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9çğıöşü\s]+/gi, " ")
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part.length > 2 && !["senior", "junior", "lead", "staff", "principal", "associate", "intern", "full", "part", "time", "remote", "hybrid", "draft"].includes(part)),
  );
}

function firstMeaningful(items: Array<string | null | undefined>) {
  return items.map((item) => item?.trim()).find((item): item is string => Boolean(item)) ?? null;
}

export function getCandidateDecisionGuidance(input: CandidateIntelligenceInput) {
  const snapshot = getCandidateReadinessSnapshot(input);
  const completeness = snapshot.completeness;
  const confidence = snapshot.confidence;

  if (!snapshot.contactReady || !snapshot.compensationReady) {
    return {
      label: "Hold for profile completion",
      tone: "amber" as const,
      body: "Key contact or compensation fields are still missing. Finalize the profile before pushing the candidate deeper into the pipeline.",
    };
  }

  if (input.parseReviewRequired || confidence < 70 || !snapshot.experienceReady) {
    return {
      label: "Normalize before approval",
      tone: "amber" as const,
      body: "The profile has enough signal to continue, but the admin team should clean up structured experience, language, and normalization details first.",
    };
  }

  if (completeness >= 85 && confidence >= 80 && snapshot.languageReady) {
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

export function getCandidateExecutiveBrief(input: CandidateIntelligenceInput): CandidateExecutiveBrief {
  const snapshot = getCandidateReadinessSnapshot(input);
  const completeness = snapshot.completeness;
  const confidence = snapshot.confidence;
  const { englishLevel } = snapshot;

  const strengths = [
    input.currentTitle ? `Current title: ${input.currentTitle}` : null,
    input.yearsExperience != null ? `Experience: ${input.yearsExperience} years` : null,
    input.location ? `Location: ${input.location}` : null,
    input.parsedSkills?.length ? `Skills: ${input.parsedSkills.slice(0, 4).join(", ")}` : null,
    snapshot.compensationReady ? `Compensation: ${snapshot.salaryLabel}` : null,
    englishLevel ? `English: ${englishLevel}` : null,
    input.parsedExperience?.length ? "Structured experience captured" : null,
    input.parsedEducation?.length ? "Education captured" : null,
  ].filter((item): item is string => Boolean(item));

  const riskFlags = [
    !input.phone ? "Missing phone number" : null,
    input.expectedSalary == null ? "Compensation not captured" : null,
    !input.parsedExperience?.length ? "Experience structure is thin" : null,
    !input.parsedEducation?.length ? "Education structure is thin" : null,
    !input.parsedSkills?.length ? "Skills remain generic" : null,
    !englishLevel ? "English level not captured" : null,
    input.parseReviewRequired ? "Admin normalization required" : null,
    confidence > 0 && confidence < 70 ? `Parse confidence ${confidence}% is below the preferred review threshold` : null,
  ].filter((item): item is string => Boolean(item));

  const normalizationNotes = [
    input.phone ? null : "Confirm a phone number before client outreach.",
    input.expectedSalary == null ? "Capture compensation expectations before publishing." : null,
    input.summary || input.standardizedProfile ? null : "Write a recruiter-ready summary before the handoff.",
    input.parsedExperience?.length ? null : "Normalize the experience timeline so the brief reads cleanly.",
    input.parsedEducation?.length ? null : "Normalize education details if they are available in the source CV.",
    englishLevel ? null : "Record language proficiency before the final client review.",
    input.parseReviewRequired ? "Admin review is still recommended before publish." : null,
  ].filter((item): item is string => Boolean(item));

  const roleKeywords = normalizeKeywordSet(input.roleTitle);
  const titleKeywords = normalizeKeywordSet(input.currentTitle);
  const skillKeywords = normalizeKeywordSet(input.parsedSkills?.join(" "));
  const overlap = [...roleKeywords].filter((keyword) => titleKeywords.has(keyword) || skillKeywords.has(keyword));
  const overlapSummary = firstMeaningful([
    overlap.length ? `Alignment around ${overlap.slice(0, 3).join(", ")}.` : null,
    input.currentTitle && input.roleTitle
      ? `Current title and submitted role should be normalized together before approval.`
      : null,
    input.currentTitle ? `Current title gives the client a quick read on the candidate profile.` : null,
    input.parsedSkills?.length ? `Structured skills support a fast human review.` : null,
    "The profile is clear enough for stakeholder review, but it still benefits from a short admin pass.",
  ])!;

  let fitScore = 30;
  fitScore += Math.min(18, Math.round(completeness * 0.18));
  fitScore += confidence ? Math.min(16, Math.round(confidence * 0.16)) : 0;
  fitScore += input.currentTitle ? 6 : 0;
  fitScore += input.location ? 3 : 0;
  fitScore += input.parsedSkills?.length ? Math.min(10, input.parsedSkills.length * 2) : 0;
  fitScore += input.parsedExperience?.length ? 8 : 0;
  fitScore += input.parsedEducation?.length ? 4 : 0;
  fitScore += input.parseReviewRequired ? -12 : 4;
  fitScore += input.expectedSalary != null ? 2 : 0;

  fitScore = Math.max(0, Math.min(100, fitScore));

  const fitLabel =
    fitScore >= 85 && !input.parseReviewRequired
      ? "Executive-ready profile"
      : fitScore >= 70
        ? "Strong profile, admin pass recommended"
        : fitScore >= 55
          ? "Review before publish"
          : "Normalization required";

  return {
    fitScore,
    fitLabel,
    fitSummary: overlapSummary,
    strengths: strengths.slice(0, 5),
    riskFlags: riskFlags.slice(0, 6),
    normalizationNotes: normalizationNotes.slice(0, 5),
    adminReady: fitScore >= 80 && !input.parseReviewRequired && completeness >= 80 && confidence >= 70,
    spotlight: firstMeaningful([
      input.currentTitle,
      input.roleTitle,
      strengths[0],
      strengths[1],
    ]) ?? "Candidate profile",
  };
}
