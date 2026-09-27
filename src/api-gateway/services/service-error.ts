export class ServiceError extends Error {
  /** Seconds until a retry can succeed; sent as the Retry-After header by the error handlers. */
  public retryAfter?: number | undefined;
  constructor(public status: number, public code: string, message: string, retryAfter?: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}
