/**
 * Minimal dependency-free structured logger.
 *   LOG_LEVEL=debug  -> everything, including full webhook bodies
 *   LOG_LEVEL=info    -> default; step-level tracing
 *   LOG_LEVEL=warn    -> warnings + errors only
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function emit(level: Level, mod: string, msg: string, data?: unknown): void {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString().slice(11, 23);
  const line = `${ts}  ${level.toUpperCase().padEnd(5)} [${mod}] ${msg}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (data === undefined) sink(line);
  else {
    let rendered: string;
    try {
      rendered = typeof data === "string" ? data : JSON.stringify(data);
    } catch {
      rendered = String(data);
    }
    sink(`${line}  ${rendered}`);
  }
}

export interface Logger {
  (msg: string, data?: unknown): void;
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

/** `const log = logger("razorpay/webhook"); log("received", {...})` */
export function logger(mod: string): Logger {
  const fn = ((msg: string, data?: unknown) => emit("info", mod, msg, data)) as Logger;
  fn.debug = (msg, data) => emit("debug", mod, msg, data);
  fn.info = (msg, data) => emit("info", mod, msg, data);
  fn.warn = (msg, data) => emit("warn", mod, msg, data);
  fn.error = (msg, data) => emit("error", mod, msg, data);
  return fn;
}
