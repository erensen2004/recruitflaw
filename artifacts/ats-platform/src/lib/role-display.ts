export const WORK_MODES = ["full office", "hybrid", "full remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = ["full-time", "part-time", "other"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type RoleMeta = {
  workMode?: WorkMode;
  employmentType?: EmploymentType;
  employmentTypeDescription?: string;
};

const ROLE_META_MARKER = "\n\n[RecruitFlow meta]\n";

export const workModeLabel: Record<WorkMode, string> = {
  "full office": "Full office",
  hybrid: "Hybrid",
  "full remote": "Full remote",
};

export const employmentTypeLabel: Record<EmploymentType, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  other: "Other",
};

export function parseRoleDescription(description?: string | null) {
  if (!description) {
    return { body: "", meta: {} as RoleMeta };
  }

  const markerIndex = description.indexOf(ROLE_META_MARKER);
  if (markerIndex === -1) {
    return { body: description.trim(), meta: {} as RoleMeta };
  }

  const body = description.slice(0, markerIndex).trim();
  const metaText = description.slice(markerIndex + ROLE_META_MARKER.length).trim();

  try {
    const meta = JSON.parse(metaText) as RoleMeta;
    return { body, meta };
  } catch {
    return { body: description.trim(), meta: {} as RoleMeta };
  }
}

export function serializeRoleDescription(body: string, meta: RoleMeta) {
  const trimmedBody = body.trim();
  const cleanMeta = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value != null && String(value).trim() !== ""),
  ) as RoleMeta;

  if (!Object.keys(cleanMeta).length) {
    return trimmedBody;
  }

  const suffix = `${ROLE_META_MARKER}${JSON.stringify(cleanMeta)}`;
  return trimmedBody ? `${trimmedBody}${suffix}` : suffix.trimStart();
}

export function formatSalaryTL(amount?: number | null) {
  if (amount == null) return null;
  return `TL ${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(amount)}`;
}

export function toApiWorkMode(workMode?: WorkMode | "" | null) {
  if (!workMode) return undefined;
  if (workMode === "full office") return "full-office";
  if (workMode === "full remote") return "full-remote";
  return workMode;
}

export function resolveWorkMode(role: { description?: string | null; workMode?: string | null; isRemote?: boolean | null }) {
  const { meta } = parseRoleDescription(role.description);
  if (meta.workMode) return meta.workMode;
  if (role.workMode === "full-office") return "full office";
  if (role.workMode === "hybrid") return "hybrid";
  if (role.workMode === "full-remote") return "full remote";
  return role.isRemote ? "full remote" : "full office";
}

export function resolveEmploymentType(role: { description?: string | null; employmentType?: string | null }) {
  const { meta } = parseRoleDescription(role.description);
  if (meta.employmentType) return meta.employmentType;
  if (role.employmentType === "full-time" || role.employmentType === "part-time" || role.employmentType === "other") {
    return role.employmentType;
  }
  return role.employmentType ? "other" : "";
}

export function resolveEmploymentTypeDescription(role: { description?: string | null }) {
  const { meta } = parseRoleDescription(role.description);
  return meta.employmentTypeDescription ?? "";
}

export function getRoleSummaryLines(role: {
  location?: string | null;
  salaryMax?: number | null;
  employmentType?: string | null;
  workMode?: string | null;
  isRemote?: boolean | null;
  description?: string | null;
}) {
  const workMode = resolveWorkMode(role);
  const employmentType = resolveEmploymentType(role);
  return {
    workMode,
    workModeLabel: workModeLabel[workMode],
    employmentType,
    employmentTypeLabel: employmentType ? employmentTypeLabel[employmentType as EmploymentType] : null,
    salaryLabel: formatSalaryTL(role.salaryMax),
    descriptionBody: parseRoleDescription(role.description).body,
  };
}
