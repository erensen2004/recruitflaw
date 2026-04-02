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
};

export function getCandidateLanguageReadiness(input: CandidateIntelligenceInput) {
  const { englishLevel } = parseCandidateTags(input.tags);
  const languagesText = input.languages?.trim();
  const normalizedLanguageItems =
    input.languageItems
      ?.map((item) => {
        const label = [item.name, item.level].filter(Boolean).join(" ");
        return label.trim() || item.name || null;
      })
      .filter((item): item is string => Boolean(item)) ?? [];

  return {
    englishLevel,
    languageLabel: englishLevel ?? normalizedLanguageItems[0] ?? languagesText ?? "Not provided",
    languageReady: Boolean(englishLevel || normalizedLanguageItems.length || languagesText),
    languageItems: normalizedLanguageItems,
  };
}

export function getCandidateCompleteness(input: CandidateIntelligenceInput) {
  const checks = [
    Boolean(input.email?.trim()),
    Boolean(input.currentTitle?.trim()),
    Boolean(input.location?.trim()),
    Boolean(input.phone),
    input.expectedSalary != null,
    Boolean(input.languages?.trim() || input.languageItems?.length),
    Boolean(input.professionalSnapshot?.trim() || input.summary?.trim()),
    Boolean(input.parsedSkills?.length),
    Boolean(input.parsedExperience?.length),
    Boolean(input.parsedEducation?.length),
    Boolean(input.executiveHeadline?.trim()),
    Boolean(input.domainFocus?.length),
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
}

export function getCandidateReadinessSnapshot(input: CandidateIntelligenceInput) {
  const completeness = getCandidateCompleteness(input);
  const confidence = input.parseConfidence ?? 0;
  const { englishLevel, languageLabel, languageReady, languageItems } = getCandidateLanguageReadiness(input);
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
    input.parseReviewRequired ? "Some profile details still need confirmation" : null,
    confidence > 0 && confidence < 70 ? "Parse confidence is below the preferred review threshold" : null,
    ...(input.candidateRisks ?? []),
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
    languageItems,
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
  headline: string;
  summary: string | null;
  professionalSnapshot: string;
  domainFocus: string[];
  strengths: string[];
  riskFlags: string[];
  notableAchievements: string[];
  experienceHighlights: string[];
  openPoints: string[];
  normalizationNotes: string[];
  workModel: string | null;
  locationFlexibility: string | null;
  salarySignal: string | null;
  adminReady: boolean;
  spotlight: string;
  coreExperience: Array<{
    header: string;
    timeline: string | null;
    scope: string | null;
    techStack: string[];
  }>;
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

function splitSentences(value?: string | null) {
  return (value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => /[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
}

function mergeUniqueSentences(values: Array<string | null | undefined>, maxSentences = 5) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of values) {
    for (const sentence of splitSentences(value)) {
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(sentence);
      if (merged.length >= maxSentences) return merged.join(" ");
    }
  }

  return merged.join(" ");
}

function firstMeaningful(items: Array<string | null | undefined>) {
  return items.map((item) => item?.trim()).find((item): item is string => Boolean(item)) ?? null;
}

function formatNaturalList(values: string[], conjunction = "ve") {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values.at(-1)}`;
}

function uniqueStrings(values: Array<string | null | undefined>, maxItems = 6) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).slice(0, maxItems);
}

function buildExperienceHighlights(input: CandidateIntelligenceInput) {
  return uniqueStrings(
    (input.parsedExperience ?? []).flatMap((item: any) => [
      ...(item?.impactHighlights ?? []),
      ...(item?.highlights ?? []),
    ]),
    6,
  );
}

function buildCoreExperience(input: CandidateIntelligenceInput) {
  return (input.parsedExperience ?? [])
    .slice(0, 5)
    .map((item: any) => {
      const header = [item?.title, item?.company].filter(Boolean).join(" @ ");
      const timeline = [item?.startDate, item?.endDate].filter(Boolean).join(" - ") || null;
      return {
        header: header || "Deneyim kaydı",
        timeline,
        scope: item?.scope ?? null,
        techStack: (item?.techStack ?? []).filter(Boolean).slice(0, 6),
      };
    })
    .filter((item) => item.header || item.timeline || item.scope || item.techStack.length);
}

export function getCandidateDecisionGuidance(input: CandidateIntelligenceInput) {
  const snapshot = getCandidateReadinessSnapshot(input);
  const completeness = snapshot.completeness;
  const confidence = snapshot.confidence;

  if (!snapshot.contactReady || !snapshot.compensationReady) {
    return {
      label: "Profil tamamlanmalı",
      tone: "amber" as const,
      body: "İletişim veya ücret beklentisi gibi temel alanlar eksik. Profili daha ileri aşamaya taşımadan önce tamamlamak gerekir.",
    };
  }

  if (input.parseReviewRequired || confidence < 70 || !snapshot.experienceReady) {
    return {
      label: "Onay öncesi kısa temizlik gerekli",
      tone: "amber" as const,
      body: "Profilde yeterli sinyal var, ancak deneyim akışı ve birkaç alan wider paylaşım öncesinde toparlanmalı.",
    };
  }

  if (completeness >= 85 && confidence >= 80 && snapshot.languageReady) {
    return {
      label: "Müşteri paylaşımına hazır",
      tone: "emerald" as const,
      body: "Aday kaydı dolu, parse kalitesi güçlü ve profil hızlı stakeholder review için hazır.",
    };
  }

  return {
    label: "Güçlü profil, birkaç açık nokta var",
    tone: "blue" as const,
    body: "Kayıt genel olarak güçlü görünüyor; daha ikna edici olması için kısa bir polish pass yeterli.",
  };
}

export function getCandidateExecutiveBrief(input: CandidateIntelligenceInput): CandidateExecutiveBrief {
  const snapshot = getCandidateReadinessSnapshot(input);
  const completeness = snapshot.completeness;
  const confidence = snapshot.confidence;
  const { englishLevel } = snapshot;
  const domainFocus = uniqueStrings([...(input.domainFocus ?? []), ...(input.parsedSkills ?? []).slice(0, 4)], 5);
  const headline =
    firstMeaningful([
      input.executiveHeadline,
      input.currentTitle,
      input.roleTitle ? `${input.roleTitle} için aday profili` : null,
    ]) ?? "Aday profili";

  const strengths = uniqueStrings([
    ...(input.candidateStrengths ?? []),
    input.currentTitle ? `${input.currentTitle} odağı net görünüyor` : null,
    input.yearsExperience != null ? `${input.yearsExperience} yıllık ilgili deneyim sinyali var` : null,
    input.location ? `${input.location} bazlı çalışıyor` : null,
    input.parsedSkills?.length ? `Öne çıkan teknik alanlar: ${input.parsedSkills.slice(0, 4).join(", ")}` : null,
    snapshot.compensationReady ? snapshot.salaryLabel : null,
    englishLevel ? `İngilizce seviyesi ${englishLevel}` : null,
    input.parsedExperience?.length ? "Deneyim zaman akışı belirgin" : null,
    input.parsedEducation?.length ? "Eğitim geçmişi görünür durumda" : null,
  ]);

  const riskFlags = uniqueStrings([
    ...(input.candidateRisks ?? []),
    !input.phone ? "Telefon numarası eksik" : null,
    input.expectedSalary == null ? "Ücret beklentisi kaynak CV'de görünmüyor" : null,
    !input.parsedExperience?.length ? "Deneyim geçmişi daha temiz yapılandırılmalı" : null,
    !input.parsedEducation?.length ? "Eğitim bilgisi sınırlı kalmış" : null,
    !input.parsedSkills?.length ? "Teknik yetenekler daha spesifik çıkarılmalı" : null,
    !englishLevel ? "İngilizce seviyesi açık şekilde doğrulanmamış" : null,
    input.parseReviewRequired ? "Kısa bir admin temizlik turu faydalı olur" : null,
    confidence > 0 && confidence < 70 ? `Profil güven skoru şu an ${confidence}%` : null,
  ]);

  const normalizationNotes = uniqueStrings([
    input.phone ? null : "Müşteri paylaşımı öncesi telefon numarası doğrulanmalı.",
    input.expectedSalary == null ? "Rol için önemliyse ücret beklentisi ayrıca teyit edilmeli." : null,
    input.professionalSnapshot || input.summary || input.standardizedProfile
      ? null
      : "Paylaşım öncesi daha güçlü bir recruiter özeti eklenmeli.",
    input.parsedExperience?.length ? null : "Deneyim akışı netleştirilirse brief daha ikna edici olur.",
    input.parsedEducation?.length ? null : "Varsa eğitim bilgisi daha açık yazılmalı.",
    englishLevel ? null : "Son stakeholder review öncesi dil yetkinliği netleştirilmeli.",
    input.parseReviewRequired ? "Kısa bir iç gözden geçirme brief kalitesini artırır." : null,
  ]);

  const roleKeywords = normalizeKeywordSet(input.roleTitle);
  const titleKeywords = normalizeKeywordSet(input.currentTitle);
  const skillKeywords = normalizeKeywordSet(input.parsedSkills?.join(" "));
  const overlap = [...roleKeywords].filter((keyword) => titleKeywords.has(keyword) || skillKeywords.has(keyword));
  const overlapSummary = firstMeaningful([
    input.professionalSnapshot,
    overlap.length ? `Rol uyumu en çok ${overlap.slice(0, 3).join(", ")} tarafında görünüyor.` : null,
    input.currentTitle && input.roleTitle
      ? `${input.currentTitle} geçmişi, sunulan ${input.roleTitle} rolüyle anlamlı uyum gösteriyor.`
      : null,
    input.currentTitle ? `${input.currentTitle} deneyimi profile net bir teknik yön veriyor.` : null,
    input.parsedSkills?.length ? `Yapılandırılmış yetenekler profili hızlı review için okunur kılıyor.` : null,
    "Profil stakeholder review için yeterince net; yalnızca birkaç detay teyit edilirse daha güçlü olur.",
  ])!;
  const summary = firstMeaningful([
    input.summary,
    overlapSummary,
  ]);
  const professionalSnapshot = firstMeaningful([
    input.professionalSnapshot,
    mergeUniqueSentences([summary?.trim(), overlapSummary]),
    summary,
    input.standardizedProfile,
  ]) ?? "Aday özeti şu anda normalize ediliyor.";
  const experienceHighlights = uniqueStrings([
    ...buildExperienceHighlights(input),
    ...(input.notableAchievements ?? []),
  ], 6);
  const notableAchievements = uniqueStrings([
    ...(input.notableAchievements ?? []),
    ...buildExperienceHighlights(input),
  ], 4);
  const openPoints = riskFlags.slice(0, 4);
  const coreExperience = buildCoreExperience(input);

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
      ? "Üst düzey review için hazır"
      : fitScore >= 70
        ? "Güçlü review adayı"
        : fitScore >= 55
          ? "Açık noktaları olan net profil"
          : "Profil temizliği gerekli";

  return {
    fitScore,
    fitLabel,
    fitSummary:
      fitScore >= 80
        ? "Profil recruiter açısından güçlü okunuyor ve kısa sürede karar vermeyi kolaylaştırıyor."
        : fitScore >= 65
          ? "Profilde işe yarar sinyal var; birkaç açık nokta kapatılırsa çok daha güçlü görünür."
          : "Profil paylaşılabilir durumda, ancak ikna gücü için ek temizlik gerekiyor.",
    headline,
    summary,
    professionalSnapshot,
    domainFocus,
    strengths,
    riskFlags,
    notableAchievements,
    experienceHighlights,
    openPoints,
    normalizationNotes,
    workModel: input.inferredWorkModel ?? null,
    locationFlexibility: input.locationFlexibility ?? null,
    salarySignal: input.salarySignal ?? (snapshot.compensationReady ? `Ücret: ${snapshot.salaryLabel}` : null),
    adminReady: fitScore >= 80 && !input.parseReviewRequired && completeness >= 80 && confidence >= 70,
    spotlight: firstMeaningful([
      input.executiveHeadline,
      input.currentTitle,
      input.roleTitle,
      strengths[0],
      strengths[1],
    ]) ?? "Aday profili",
    coreExperience,
  };
}
