import type { AppConfig } from "./config.js";

const priorities = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof priorities;

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(config: Pick<AppConfig, "logLevel">): Logger {
  const threshold = priorities[config.logLevel];
  const write = (level: Level, message: string, context?: Record<string, unknown>) => {
    if (priorities[level] < threshold) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ? { context } : {}),
    };
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
