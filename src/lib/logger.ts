import pino, { type Logger } from 'pino';

/**
 * Structured logging. Sensitive keys are redacted wherever they appear (top level or
 * nested one deep). Pretty output in development, JSON elsewhere. Never log request
 * bodies wholesale — log ids, codes, and durations.
 */
const REDACT_PATHS = [
  'otp', 'code', 'token', 'secret', 'password', 'email', 'phone', 'authorization', 'cookie', 'voucher',
  '*.otp', '*.code', '*.token', '*.secret', '*.password', '*.email', '*.phone', '*.authorization', '*.cookie', '*.voucher',
  'req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie',
];

const nodeEnv = process.env.NODE_ENV ?? 'development';
const level = process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : nodeEnv === 'production' ? 'info' : 'debug');

function build(): Logger {
  const base = { level, redact: { paths: REDACT_PATHS, censor: '[redacted]' }, base: { service: 'wedding' } };
  if (nodeEnv === 'development' && process.env.LOG_FORMAT !== 'json') {
    try {
      return pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } } });
    } catch {
      // pino-pretty unavailable (e.g. bundled runtime) — fall back to JSON.
    }
  }
  return pino(base);
}

const g = globalThis as unknown as { __weddingLogger?: Logger };
export const logger: Logger = g.__weddingLogger ?? (g.__weddingLogger = build());

export type { Logger };

/** Child logger bound to a request id. */
export const requestLogger = (requestId: string, bindings: Record<string, unknown> = {}): Logger =>
  logger.child({ requestId, ...bindings });
