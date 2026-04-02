/** Minimal structured logger used across the service. */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "pretty";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

export interface LogContext {
  requestId?: string;
  model?: string;
  [key: string]: unknown;
}

export class Logger {
  private readonly level: number;
  private readonly format: LogFormat;
  private readonly context: LogContext;

  constructor(
    level: LogLevel = "info",
    format: LogFormat = "pretty",
    context: LogContext = {}
  ) {
    this.level = LEVEL_ORDER[level];
    this.format = format;
    this.context = context;
  }

  /** Returns a logger that includes extra context fields on every entry. */
  child(context: LogContext): Logger {
    const merged = { ...this.context, ...context };
    const level = Object.entries(LEVEL_ORDER).find(
      ([, value]) => value === this.level
    )?.[0] as LogLevel;
    return new Logger(level, this.format, merged);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (LEVEL_ORDER[level] < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };

    if (this.format === "json") {
      this.writeJSON(entry);
    } else {
      this.writePretty(level, message, entry);
    }
  }

  private writeJSON(entry: Record<string, unknown>): void {
    const out = entry.level === "error" ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + "\n");
  }

  private writePretty(
    level: LogLevel,
    message: string,
    entry: Record<string, unknown>
  ): void {
    const color = LEVEL_COLORS[level];
    const time = new Date().toLocaleTimeString();
    const prefix = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
    const reqId = entry.requestId
      ? ` ${"\x1b[90m"}[${entry.requestId}]${RESET}`
      : "";

    const extras = { ...entry };
    delete extras.timestamp;
    delete extras.level;
    delete extras.message;
    delete extras.requestId;

    const extraStr =
      Object.keys(extras).length > 0
        ? ` ${"\x1b[90m"}${JSON.stringify(extras)}${RESET}`
        : "";

    const out = level === "error" ? process.stderr : process.stdout;
    out.write(
      `${"\x1b[90m"}${time}${RESET} ${prefix}${reqId} ${message}${extraStr}\n`
    );
  }
}

/** Global logger instance, replaced during startup. */
let globalLogger = new Logger("info", "pretty");

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getLogger(): Logger {
  return globalLogger;
}
