import { Response } from "express";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface ApiError {
  error: string;
  code: ApiErrorCode;
  details?: unknown;
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  code: ApiErrorCode,
  details?: unknown,
): void {
  const body: ApiError = { error: message, code };
  if (details !== undefined) body.details = details;
  res.status(status).json(body);
}

export const Errors = {
  validation: (res: Response, details?: unknown) =>
    sendError(res, 400, "Validation failed", "VALIDATION_ERROR", details),
  badRequest: (res: Response, message: string) =>
    sendError(res, 400, message, "BAD_REQUEST"),
  unauthorized: (res: Response, message = "Unauthorized") =>
    sendError(res, 401, message, "UNAUTHORIZED"),
  forbidden: (res: Response, message = "Forbidden") =>
    sendError(res, 403, message, "FORBIDDEN"),
  notFound: (res: Response, message = "Not found") =>
    sendError(res, 404, message, "NOT_FOUND"),
  conflict: (res: Response, message: string) =>
    sendError(res, 409, message, "CONFLICT"),
  internal: (res: Response, message = "Internal server error") =>
    sendError(res, 500, message, "INTERNAL_ERROR"),
  serviceUnavailable: (res: Response, message: string) =>
    sendError(res, 503, message, "SERVICE_UNAVAILABLE"),
};
