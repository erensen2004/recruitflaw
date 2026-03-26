import { db, candidatesTable, companiesTable, jobRolesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { Errors } from "./errors.js";

export const REVIEW_THREAD_SCOPE_TYPES = ["role", "candidate"] as const;
export const REVIEW_THREAD_VISIBILITIES = ["admin", "client", "vendor", "shared"] as const;
export const REVIEW_THREAD_STATUSES = ["open", "resolved"] as const;

export type ReviewThreadScopeType = (typeof REVIEW_THREAD_SCOPE_TYPES)[number];
export type ReviewThreadVisibility = (typeof REVIEW_THREAD_VISIBILITIES)[number];
export type ReviewThreadStatus = (typeof REVIEW_THREAD_STATUSES)[number];

export type ReviewThreadActor = {
  userId: number;
  role: "admin" | "client" | "vendor";
  companyId: number | null;
  name: string;
  companyName: string | null;
};

export type ReviewScopeContext =
  | {
      scopeType: "role";
      scopeId: number;
      title: string;
      companyId: number;
      companyName: string | null;
      status: string;
      label: string;
    }
  | {
      scopeType: "candidate";
      scopeId: number;
      candidateName: string;
      roleId: number;
      roleTitle: string;
      roleStatus: string;
      roleCompanyId: number | null;
      roleCompanyName: string | null;
      vendorCompanyId: number;
      vendorCompanyName: string | null;
      status: string;
      label: string;
    };

function isValidScopeType(value: string): value is ReviewThreadScopeType {
  return REVIEW_THREAD_SCOPE_TYPES.includes(value as ReviewThreadScopeType);
}

function isValidThreadStatus(value: string): value is ReviewThreadStatus {
  return REVIEW_THREAD_STATUSES.includes(value as ReviewThreadStatus);
}

export function canActorAccessReviewScope(
  actor: ReviewThreadActor,
  scope: ReviewScopeContext,
): boolean {
  if (actor.role === "admin") return true;

  if (scope.scopeType === "role") {
    if (actor.role === "client") {
      return Boolean(actor.companyId && actor.companyId === scope.companyId);
    }
    return scope.status === "published";
  }

  if (actor.role === "client") {
    return Boolean(actor.companyId && actor.companyId === scope.roleCompanyId) &&
      scope.status !== "pending_approval" &&
      scope.status !== "withdrawn";
  }

  return Boolean(actor.companyId && actor.companyId === scope.vendorCompanyId);
}

export function normalizeReviewVisibility(
  requested: string | null | undefined,
  actorRole: ReviewThreadActor["role"],
): ReviewThreadVisibility {
  const visibility = requested?.trim();
  if (visibility && REVIEW_THREAD_VISIBILITIES.includes(visibility as ReviewThreadVisibility)) {
    return visibility as ReviewThreadVisibility;
  }

  if (actorRole === "admin") return "shared";
  if (actorRole === "client") return "client";
  return "vendor";
}

export function normalizeReviewThreadStatus(requested: string | null | undefined): ReviewThreadStatus {
  const status = requested?.trim();
  if (status && isValidThreadStatus(status)) {
    return status;
  }

  return "open";
}

export function getReviewThreadStatusLabel(status: ReviewThreadStatus) {
  return status === "resolved" ? "Resolved" : "Open";
}

export function getReviewVisibilityLabel(visibility: ReviewThreadVisibility, scopeType?: ReviewThreadScopeType) {
  switch (visibility) {
    case "admin":
      return "Admin only";
    case "client":
      return scopeType === "candidate" ? "Client + admin" : "Client-facing";
    case "vendor":
      return scopeType === "candidate" ? "Vendor + admin" : "Vendor-facing";
    default:
      return "Shared";
  }
}

export function canSeeReviewVisibility(
  actorRole: ReviewThreadActor["role"],
  visibility: ReviewThreadVisibility,
): boolean {
  if (actorRole === "admin") return true;
  if (actorRole === "client") return visibility === "client" || visibility === "shared";
  return visibility === "vendor" || visibility === "shared";
}

export async function resolveReviewActor(userId: number): Promise<ReviewThreadActor | null> {
  const [userRow] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      companyId: usersTable.companyId,
      name: usersTable.name,
      companyName: companiesTable.name,
    })
    .from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(eq(usersTable.id, userId));

  if (!userRow) {
    return null;
  }

  return {
    userId: userRow.id,
    role: userRow.role as ReviewThreadActor["role"],
    companyId: userRow.companyId,
    name: userRow.name,
    companyName: userRow.companyName ?? null,
  };
}

export async function describeReviewScope(
  scopeType: string,
  scopeId: number,
): Promise<ReviewScopeContext | null> {
  if (!isValidScopeType(scopeType)) {
    return null;
  }

  if (scopeType === "role") {
    const [row] = await db
      .select({
        id: jobRolesTable.id,
        title: jobRolesTable.title,
        status: jobRolesTable.status,
        companyId: jobRolesTable.companyId,
        companyName: companiesTable.name,
      })
      .from(jobRolesTable)
      .leftJoin(companiesTable, eq(jobRolesTable.companyId, companiesTable.id))
      .where(eq(jobRolesTable.id, scopeId));

    if (!row) {
      return null;
    }

    return {
      scopeType: "role",
      scopeId: row.id,
      title: row.title,
      companyId: row.companyId,
      companyName: row.companyName ?? null,
      status: row.status,
      label: `${row.title} • ${row.companyName ?? "Unknown company"}`,
    };
  }

  const [row] = await db
    .select({
      id: candidatesTable.id,
      firstName: candidatesTable.firstName,
      lastName: candidatesTable.lastName,
      status: candidatesTable.status,
      roleId: candidatesTable.roleId,
      vendorCompanyId: candidatesTable.vendorCompanyId,
      roleTitle: jobRolesTable.title,
      roleStatus: jobRolesTable.status,
      roleCompanyId: jobRolesTable.companyId,
    })
    .from(candidatesTable)
    .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
    .where(eq(candidatesTable.id, scopeId));

  if (!row) {
    return null;
  }

  const [vendorCompanyRow] = await db
    .select({ name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, row.vendorCompanyId));

  let roleCompanyName: string | null = null;
  if (row.roleCompanyId != null) {
    const [roleCompanyRow] = await db
      .select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, row.roleCompanyId));
    roleCompanyName = roleCompanyRow?.name ?? null;
  }

  const candidateName = `${row.firstName} ${row.lastName}`;
  return {
    scopeType: "candidate",
    scopeId: row.id,
    candidateName,
    roleId: row.roleId,
    roleTitle: row.roleTitle ?? "",
    roleStatus: row.roleStatus ?? "draft",
    roleCompanyId: row.roleCompanyId,
    roleCompanyName,
    vendorCompanyId: row.vendorCompanyId,
    vendorCompanyName: vendorCompanyRow?.name ?? null,
    status: row.status,
    label: `${candidateName} • ${row.roleTitle ?? "Role"}`,
  };
}

export async function resolveReviewScope(
  req: Request,
  res: Response,
  scopeType: string,
  scopeId: number,
): Promise<ReviewScopeContext | null> {
  if (!isValidScopeType(scopeType)) {
    Errors.badRequest(res, "scopeType must be role or candidate");
    return null;
  }

  const scope = await describeReviewScope(scopeType, scopeId);
  if (!scope) {
    Errors.notFound(res, scopeType === "role" ? "Role not found" : "Candidate not found");
    return null;
  }

  const actor = req.user!;
  const actorContext: ReviewThreadActor = {
    userId: actor.userId,
    role: actor.role as ReviewThreadActor["role"],
    companyId: actor.companyId ?? null,
    name: "",
    companyName: null,
  };

  if (!canActorAccessReviewScope(actorContext, scope)) {
    if (scope.scopeType === "role" && actor.role === "vendor" && scope.status !== "published") {
      Errors.forbidden(res, "Vendors can only discuss published roles");
      return null;
    }

    if (scope.scopeType === "candidate" && actor.role === "client") {
      Errors.notFound(res, "Candidate not found");
      return null;
    }

    Errors.forbidden(res);
    return null;
  }

  return scope;
}
