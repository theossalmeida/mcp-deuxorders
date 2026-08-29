import type { EngineEvent, EngineLogger } from "@invokta/core";

function write(record: Readonly<Record<string, unknown>>): void {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

export const auditLogger: EngineLogger = {
  debug: (message, details) => write({ level: "debug", message, ...details }),
  info: (message, details) => write({ level: "info", message, ...details }),
  warn: (message, details) => write({ level: "warn", message, ...details }),
  error: (message, details) => write({ level: "error", message, ...details }),
};

export function recordEngineEvent(event: EngineEvent): void {
  write({ level: "audit", ...event });
}
