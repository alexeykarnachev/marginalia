// Error classification for Marginalia.
// Distinguishes transient (retry-worthy) from permanent errors.

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'fatal';

export class AppError extends Error {
  severity: ErrorSeverity;
  retryable: boolean;

  constructor(message: string, options?: {
    severity?: ErrorSeverity;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'AppError';
    this.severity = options?.severity ?? 'error';
    this.retryable = options?.retryable ?? false;
    if (options?.cause) this.cause = options.cause;
  }
}

/** Returns true if the error is transient and worth retrying (stale connection, etc.) */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof DOMException) {
    // Stale connection errors — recoverable by reconnecting
    return err.name === 'InvalidStateError'
      || err.name === 'TransactionInactiveError'
      || err.name === 'AbortError';
  }
  // Generic errors with IDB-related messages
  const msg = (err as Error)?.message ?? '';
  return msg.includes('connection') || msg.includes('closing');
}

/** Returns true if the error is permanent and should not be retried */
export function isPermanentDbError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'QuotaExceededError'
      || err.name === 'NotAllowedError'
      || err.name === 'NotFoundError';
  }
  return false;
}

/** Format any error into a readable message */
export function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
