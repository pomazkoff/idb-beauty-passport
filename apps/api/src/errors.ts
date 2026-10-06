/** Коды ошибок API (ТЗ 9.2). Конверт: { errors: [{ code, message, meta? }] } */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "QUESTION_NOT_FOUND"
  | "OPTION_NOT_ALLOWED"
  | "STAGE_NOT_COMPLETE"
  | "BRANCH_NOT_AVAILABLE"
  | "SURVEY_VERSION_MISMATCH"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 422,
  QUESTION_NOT_FOUND: 404,
  OPTION_NOT_ALLOWED: 422,
  STAGE_NOT_COMPLETE: 409,
  BRANCH_NOT_AVAILABLE: 422,
  SURVEY_VERSION_MISMATCH: 409,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
  toBody() {
    return {
      errors: [{ code: this.code, message: this.message, ...(this.meta ? { meta: this.meta } : {}) }],
    };
  }
}
