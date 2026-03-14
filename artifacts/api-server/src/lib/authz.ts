import { Request, Response, NextFunction } from "express";
import { db, candidatesTable, jobRolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Errors } from "./errors.js";

export type UserRole = "admin" | "client" | "vendor";

/**
 * Check if the authenticated user can access a candidate.
 * Returns the candidate row if allowed, sends a 403/404 otherwise.
 */
export async function resolveCandidateAccess(
  req: Request,
  res: Response,
  candidateId: number,
): Promise<{
  id: number;
  roleId: number;
  vendorCompanyId: number;
  roleCompanyId: number | null;
} | null> {
  const { role: userRole, companyId } = req.user!;

  const [row] = await db
    .select({
      id: candidatesTable.id,
      roleId: candidatesTable.roleId,
      vendorCompanyId: candidatesTable.vendorCompanyId,
      roleCompanyId: jobRolesTable.companyId,
    })
    .from(candidatesTable)
    .leftJoin(jobRolesTable, eq(candidatesTable.roleId, jobRolesTable.id))
    .where(eq(candidatesTable.id, candidateId));

  if (!row) {
    Errors.notFound(res, "Candidate not found");
    return null;
  }

  if (userRole === "admin") return row;

  if (userRole === "client") {
    if (!companyId || row.roleCompanyId !== companyId) {
      Errors.forbidden(res);
      return null;
    }
    return row;
  }

  if (userRole === "vendor") {
    if (!companyId || row.vendorCompanyId !== companyId) {
      Errors.forbidden(res);
      return null;
    }
    return row;
  }

  Errors.forbidden(res);
  return null;
}

/**
 * Check if the authenticated user can access a job role.
 */
export async function resolveRoleAccess(
  req: Request,
  res: Response,
  roleId: number,
): Promise<{ id: number; companyId: number; status: string } | null> {
  const { role: userRole, companyId } = req.user!;

  const [row] = await db
    .select({
      id: jobRolesTable.id,
      companyId: jobRolesTable.companyId,
      status: jobRolesTable.status,
    })
    .from(jobRolesTable)
    .where(eq(jobRolesTable.id, roleId));

  if (!row) {
    Errors.notFound(res, "Role not found");
    return null;
  }

  if (userRole === "admin") return row;

  if (userRole === "client") {
    if (!companyId || row.companyId !== companyId) {
      Errors.forbidden(res);
      return null;
    }
    return row;
  }

  Errors.forbidden(res, "Vendors cannot modify roles");
  return null;
}

/**
 * Middleware: require one of the given roles, otherwise send 403.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      Errors.unauthorized(res);
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      Errors.forbidden(res);
      return;
    }
    next();
  };
}
