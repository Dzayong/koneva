export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'validation_error', message, details);
}

export function unauthorizedError(message = 'Invalid or missing API key'): ApiError {
  return new ApiError(401, 'unauthorized', message);
}

export function notFoundError(message: string): ApiError {
  return new ApiError(404, 'not_found', message);
}

export function tooManyRequestsError(message = 'Too many requests'): ApiError {
  return new ApiError(429, 'rate_limited', message);
}

export function internalError(message = 'Internal server error'): ApiError {
  return new ApiError(500, 'internal_error', message);
}
