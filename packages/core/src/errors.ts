/**
 * Structured errors shared by the REST API, MCP tools and job results, so a
 * human or an agent always receives a machine-readable `code` plus a message.
 */
export const ERROR_CODES = [
  "validation_error",
  "not_found",
  "unauthorized",
  "conflict",
  "job_cancelled",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  job_cancelled: 409,
  internal_error: 500,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
  toBody(): ErrorBody {
    return { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) };
  }
  static notFound(what: string, id: string): AppError {
    return new AppError("not_found", `${what} ${id} was not found`);
  }
}

export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof AppError) return err.toBody();
  return { code: "internal_error", message: err instanceof Error ? err.message : String(err) };
}
