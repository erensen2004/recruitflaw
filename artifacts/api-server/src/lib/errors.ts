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
  res: any,
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
  validation: (res: any, details?: unknown) =>
    sendError(res, 400, "Validation failed", "VALIDATION_ERROR", details),
  badRequest: (res: any, message: string) =>
    sendError(res, 400, message, "BAD_REQUEST"),
  unauthorized: (res: any, message = "Unauthorized") =>
    sendError(res, 401, message, "UNAUTHORIZED"),
  forbidden: (res: any, message = "Forbidden") =>
    sendError(res, 403, message, "FORBIDDEN"),
  notFound: (res: any, message = "Not found") =>
    sendError(res, 404, message, "NOT_FOUND"),
  conflict: (res: any, message: string) =>
    sendError(res, 409, message, "CONFLICT"),
  internal: (res: any, message = "Internal server error") =>
    sendError(res, 500, message, "INTERNAL_ERROR"),
  serviceUnavailable: (res: any, message: string) =>
    sendError(res, 503, message, "SERVICE_UNAVAILABLE"),
};
