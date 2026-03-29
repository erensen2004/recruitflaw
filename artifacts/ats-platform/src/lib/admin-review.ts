type DateLike = string | Date | number | null | undefined;

export type AdminReviewRole = {
  id: number;
  title: string;
  companyName: string;
  description?: string | null;
  skills?: string | null;
  location?: string | null;
  salaryMax?: number | null;
  status: string;
  createdAt: DateLike;
  updatedAt: DateLike;
  candidateCount?: number;
};

export type AdminReviewCandidate = {
  id: number;
  firstName: string;
  lastName: string;
  roleTitle: string;
  vendorCompanyName: string;
  status: string;
  parseStatus: string;
  parseReviewRequired: boolean;
  submittedAt: DateLike;
  updatedAt?: DateLike;
  cvUrl?: string | null;
};

export type AdminReviewActivity = {
  type: string;
  candidateId?: number;
  candidateName?: string | null;
  actorName?: string | null;
  message: string;
  createdAt: string;
};

export type AdminReviewStuckItem = {
  type: "role" | "candidate";
  label: string;
  detail: string;
  route: string;
  ageDays: number;
  reason: string;
};

const ONE_DAY = 24 * 60 * 60 * 1000;

function toDate(value: DateLike) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") return new Date(value);
  return null;
}

function toLocalDayKey(value: DateLike) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA");
}

function ageInDays(value: DateLike, reference: Date) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((reference.getTime() - date.getTime()) / ONE_DAY));
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

export function getRoleReviewStateMeta(status: string) {
  switch (status) {
    case "draft":
      return {
        label: "Needs edits",
        tone: "amber" as const,
        body: "Waiting for the admin team to finalize the brief before publishing.",
      };
    case "pending_approval":
      return {
        label: "Awaiting approval",
        tone: "blue" as const,
        body: "Ready for a final admin pass before it reaches the vendor-facing list.",
      };
    case "published":
      return {
        label: "Ready to publish",
        tone: "emerald" as const,
        body: "Visible to vendors and ready for candidate flow.",
      };
    case "on_hold":
      return {
        label: "On hold",
        tone: "amber" as const,
        body: "Hiring is paused for now, but the role remains in the tracked queue.",
      };
    case "closed":
      return {
        label: "Closed",
        tone: "slate" as const,
        body: "Temporarily archived or rejected from the active hiring queue.",
      };
    default:
      return {
        label: status,
        tone: "slate" as const,
        body: "Review state unavailable.",
      };
  }
}

export function getRoleReviewActionLabel(status: string) {
  if (status === "pending_approval") return "Approve & publish";
  if (status === "draft") return "Publish";
  if (status === "published") return "Send back to draft";
  if (status === "on_hold") return "Resume publishing";
  if (status === "closed") return "Reopen as draft";
  return "Review";
}

export function matchesRoleReviewSearch(role: AdminReviewRole, search: string) {
  const query = normalizeSearch(search);
  if (!query) return true;

  const haystack = [
    role.title,
    role.companyName,
    role.description ?? "",
    role.skills ?? "",
    role.location ?? "",
    String(role.salaryMax ?? ""),
    role.status,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

export function getRoleReviewBucket(status: string) {
  if (status === "pending_approval") return "awaiting";
  if (status === "draft") return "draft";
  if (status === "published") return "published";
  if (status === "on_hold") return "on_hold";
  if (status === "closed") return "closed";
  return "other";
}

export function isStaleRole(role: AdminReviewRole, reference = new Date()) {
  const status = role.status;
  if (status !== "draft" && status !== "pending_approval") return false;

  const age = ageInDays(role.updatedAt ?? role.createdAt, reference);
  if (age == null) return false;

  return age >= 3;
}

export function isStaleCandidate(candidate: AdminReviewCandidate, reference = new Date()) {
  const age = ageInDays(candidate.updatedAt ?? candidate.submittedAt, reference);
  if (age == null) return false;

  if (candidate.status === "pending_approval") return age >= 2;
  if (candidate.parseReviewRequired || candidate.parseStatus === "partial") return age >= 2;
  return false;
}

export function buildRoleQueueSnapshot(roles: AdminReviewRole[], reference = new Date()) {
  const total = roles.length;
  const pendingApproval = roles.filter((role) => role.status === "pending_approval").length;
  const needsEdits = roles.filter((role) => role.status === "draft").length;
  const readyToPublish = roles.filter((role) => role.status === "published").length;
  const onHold = roles.filter((role) => role.status === "on_hold").length;
  const closed = roles.filter((role) => role.status === "closed").length;
  const stuckRoles = roles.filter((role) => isStaleRole(role, reference)).length;
  const todayReviews = roles.filter((role) => toLocalDayKey(role.updatedAt) === toLocalDayKey(reference)).length;

  return {
    total,
    pendingApproval,
    needsEdits,
    readyToPublish,
    onHold,
    closed,
    stuckRoles,
    todayReviews,
  };
}

export function buildAdminWorkloadSnapshot(
  roles: AdminReviewRole[],
  candidates: AdminReviewCandidate[],
  recentActivity: AdminReviewActivity[] = [],
  reference = new Date(),
) {
  const roleQueue = buildRoleQueueSnapshot(roles, reference);
  const todayKey = toLocalDayKey(reference);
  const recentToday = recentActivity.filter((item) => toLocalDayKey(item.createdAt) === todayKey);

  const submissionsToday = recentToday.filter((item) => item.type === "candidate_submitted").length;
  const statusChangesToday = recentToday.filter((item) => item.type === "candidate_status_changed").length;
  const notesToday = recentToday.filter((item) => item.type === "candidate_note_added").length;
  const roleUpdatesToday = roles.filter((role) => toLocalDayKey(role.updatedAt) === todayKey).length;
  const candidatesUpdatedToday = candidates.filter((candidate) => toLocalDayKey(candidate.updatedAt ?? candidate.submittedAt) === todayKey).length;

  const stuckRoles = roles
    .filter((role) => isStaleRole(role, reference))
    .map((role) => ({
      type: "role" as const,
      label: role.title,
      detail: role.companyName,
      route: `/admin/roles/${role.id}/candidates`,
      ageDays: ageInDays(role.updatedAt ?? role.createdAt, reference) ?? 0,
      reason:
        role.status === "pending_approval"
          ? "Awaiting admin approval"
          : "Role brief still needs final edits",
    }));

  const stuckCandidates = candidates
    .filter((candidate) => isStaleCandidate(candidate, reference))
    .map((candidate) => ({
      type: "candidate" as const,
      label: `${candidate.firstName} ${candidate.lastName}`,
      detail: `${candidate.roleTitle} · ${candidate.vendorCompanyName}`,
      route: `/admin/candidates/${candidate.id}`,
      ageDays: ageInDays(candidate.updatedAt ?? candidate.submittedAt, reference) ?? 0,
      reason:
        candidate.status === "pending_approval"
          ? "Candidate waiting for admin approval"
          : candidate.parseReviewRequired || candidate.parseStatus === "partial"
            ? "Normalization still needed"
            : "Review backlog item",
    }));

  const stuckItems = [...stuckRoles, ...stuckCandidates]
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 8);

  return {
    roleQueue,
    todayWorkload: {
      total: recentToday.length + roleUpdatesToday,
      submissionsToday,
      statusChangesToday,
      notesToday,
      roleUpdatesToday,
      candidatesUpdatedToday,
    },
    pendingCandidates: candidates.filter((candidate) => candidate.status === "pending_approval").length,
    reviewSuggestedCandidates: candidates.filter((candidate) => candidate.parseReviewRequired || candidate.parseStatus === "partial").length,
    readyCandidates: candidates.filter((candidate) => candidate.status !== "pending_approval" && !candidate.parseReviewRequired).length,
    stuckItems,
  };
}
