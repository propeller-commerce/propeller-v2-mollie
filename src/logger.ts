/**
 * Injectable logger. The WordPress plugin logged to a file via `mollie_log()`;
 * here the host can pass any logger, and we default to `console`.
 *
 * Keep it tiny on purpose — a structured `(level, message, meta)` signature so
 * hosts can route into pino/winston/console without us depending on any of them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, message: string, meta?: unknown) => void;

/** Default logger: forwards to the matching `console` method. */
export const consoleLogger: Logger = (level, message, meta) => {
  const line = `[propeller-mollie] ${message}`;
  // eslint-disable-next-line no-console
  const fn = level === 'debug' ? console.debug : console[level] ?? console.log;
  if (meta !== undefined) {
    fn(line, meta);
  } else {
    fn(line);
  }
};

/** No-op logger, useful in tests. */
export const noopLogger: Logger = () => {
  /* intentionally empty */
};
