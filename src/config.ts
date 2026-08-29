import "./env.js";

import { EngineStartupError, requireEnvironment } from "./env.js";

export interface BackendConfig {
  readonly baseUrl: string;
  readonly serviceEmail: string;
  readonly servicePassword: string;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly maxExportBytes: number;
}

export const requiredEnvironmentNames = [
  "BACKEND_URL",
  "BACKEND_SERVICE_EMAIL",
  "BACKEND_SERVICE_PASSWORD",
  "MCP_AUTH_TOKEN",
] as const;

function readInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new EngineStartupError(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

export function readBackendConfig(): BackendConfig {
  requireEnvironment(requiredEnvironmentNames);

  const rawUrl = process.env["BACKEND_URL"] ?? "";
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new EngineStartupError("BACKEND_URL must be an absolute URL.");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new EngineStartupError("BACKEND_URL must use http or https.");
  }

  // The routes already carry the /api/v1 prefix, so an address written with it
  // — the form the backend is published under — must not double it.
  const path = baseUrl.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

  return {
    baseUrl: baseUrl.origin + path,
    serviceEmail: process.env["BACKEND_SERVICE_EMAIL"] ?? "",
    servicePassword: process.env["BACKEND_SERVICE_PASSWORD"] ?? "",
    timeoutMs: readInteger("BACKEND_TIMEOUT_MS", 15_000),
    retries: readInteger("BACKEND_RETRIES", 2),
    maxExportBytes: readInteger("BACKEND_MAX_EXPORT_BYTES", 4 * 1024 * 1024),
  };
}

export function readMcpAuthToken(): string {
  requireEnvironment(["MCP_AUTH_TOKEN"]);
  const token = process.env["MCP_AUTH_TOKEN"] ?? "";
  if (token.length < 32) {
    throw new EngineStartupError("MCP_AUTH_TOKEN must have at least 32 characters.");
  }
  return token;
}
