export type PluginErrorCode =
  | 'RUNTIME_UNAVAILABLE'
  | 'OPERATION_TIMEOUT'
  | 'PLUGIN_STOPPED'
  | 'STORAGE_ERROR'
  | 'WORKER_ERROR';

export class PluginRuntimeError extends Error {
  readonly code: PluginErrorCode;
  readonly retryable: boolean;

  constructor(
    code: PluginErrorCode,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : {
      cause: options.cause,
    });
    this.name = 'PluginRuntimeError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new PluginRuntimeError(
        'OPERATION_TIMEOUT',
        `${operation} did not finish within ${formatDuration(timeoutMs)}.`,
        { retryable: true },
      ));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} seconds`;
}
