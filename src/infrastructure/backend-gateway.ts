import { EngineError } from "@invokta/core";

import type { BackendConfig } from "../config.js";
import type {
  BackendFile,
  BackendGateway,
  BackendRequest,
  QueryValue,
} from "../application/ports.js";

const tokenRefreshMarginMs = 5 * 60 * 1000;
const tokenLifetimeMs = 8 * 60 * 60 * 1000;
const retryDelayMs = 300;

interface CachedToken {
  readonly value: string;
  readonly expiresAt: number;
}

function fail(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new EngineError({
    code: "EXECUTION_FAILED",
    message,
    ...(details === undefined ? {} : { publicDetails: details }),
  });
}

function invalid(message: string): never {
  throw new EngineError({ code: "INPUT_INVALID", message });
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, QueryValue>> | undefined,
): string {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildForm(fields: Readonly<Record<string, QueryValue>>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.set(key, String(value));
  }
  return form;
}

function isRetryable(request: BackendRequest, status: number | null): boolean {
  if (request.method !== "GET") return false;
  return status === null || status === 429 || status >= 500;
}

async function readProblem(response: Response): Promise<string | null> {
  const text = await response.text().catch(() => "");
  if (text === "") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed !== "object" || parsed === null) return null;
    const problem = parsed as { detail?: unknown; errors?: unknown };
    if (typeof problem.detail === "string") return problem.detail;
    if (typeof problem.errors === "object" && problem.errors !== null) {
      const messages = Object.values(problem.errors as Record<string, unknown>)
        .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
        .filter((entry): entry is string => typeof entry === "string");
      if (messages.length > 0) return messages.join(" ");
    }
    return null;
  } catch {
    return text.slice(0, 500);
  }
}

async function raise(request: BackendRequest, response: Response): Promise<never> {
  const detail = await readProblem(response);
  const status = response.status;

  if (status === 400) invalid(detail ?? "O backend recusou os dados enviados.");
  if (status === 404) {
    fail(detail ?? "Recurso não encontrado no DeuxOrders.", { reason: "not_found" });
  }
  if (status === 409) {
    fail(detail ?? "O registro foi alterado por outra operação. Consulte novamente.", {
      reason: "conflict",
    });
  }
  if (status === 401 || status === 403) {
    fail("O MCP não tem permissão para executar esta operação no DeuxOrders.", {
      reason: "backend_permission",
    });
  }
  if (status === 429) {
    fail("O backend recusou a chamada por excesso de requisições.", { reason: "rate_limited" });
  }
  fail("O DeuxOrders não conseguiu completar a operação.", {
    reason: "backend_error",
    status,
    path: request.path,
  });
}

export function createBackendGateway(config: BackendConfig): BackendGateway {
  let cached: CachedToken | null = null;
  let pending: Promise<string> | null = null;

  async function login(signal: AbortSignal): Promise<string> {
    const response = await fetch(`${config.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: config.serviceEmail,
        password: config.servicePassword,
      }),
      signal,
    }).catch(() => null);

    if (response === null) fail("O backend do DeuxOrders está inacessível.");
    if (!response.ok) {
      fail("A credencial de serviço do MCP foi recusada pelo DeuxOrders.", {
        reason: "service_credential",
      });
    }

    const payload = (await response.json().catch(() => null)) as { token?: unknown } | null;
    if (payload === null || typeof payload.token !== "string" || payload.token === "") {
      fail("O backend respondeu ao login sem um token utilizável.");
    }

    cached = { value: payload.token, expiresAt: Date.now() + tokenLifetimeMs };
    return payload.token;
  }

  async function authorize(signal: AbortSignal, forceRefresh: boolean): Promise<string> {
    if (forceRefresh) cached = null;
    if (cached !== null && cached.expiresAt - tokenRefreshMarginMs > Date.now()) {
      return cached.value;
    }
    pending ??= login(signal).finally(() => {
      pending = null;
    });
    return pending;
  }

  async function call(
    request: BackendRequest,
    signal: AbortSignal,
    forceRefresh: boolean,
  ): Promise<Response> {
    const token = await authorize(signal, forceRefresh);
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    let body: string | FormData | undefined;

    if (request.form !== undefined) {
      body = buildForm(request.form);
    } else if (request.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(request.body);
    }

    return fetch(buildUrl(config.baseUrl, request.path, request.query), {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.any([signal, timeout]),
    });
  }

  async function dispatch(request: BackendRequest, signal: AbortSignal): Promise<Response> {
    let lastStatus: number | null = null;

    for (let attempt = 0; attempt <= config.retries; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }

      let response: Response;
      try {
        response = await call(request, signal, false);
      } catch (error) {
        if (signal.aborted) throw new EngineError({ code: "CANCELLED", message: "Operação cancelada." });
        if (error instanceof EngineError) throw error;
        lastStatus = null;
        if (!isRetryable(request, null)) fail("O backend do DeuxOrders está inacessível.");
        continue;
      }

      if (response.status === 401) {
        response = await call(request, signal, true);
      }
      if (response.ok || !isRetryable(request, response.status)) return response;
      lastStatus = response.status;
    }

    fail("O backend do DeuxOrders não respondeu após novas tentativas.", {
      reason: "unavailable",
      ...(lastStatus === null ? {} : { status: lastStatus }),
    });
  }

  const gateway: BackendGateway = {
    async send<Result>(request: BackendRequest, { signal }: { signal: AbortSignal }) {
      const response = await dispatch(request, signal);
      if (!response.ok) await raise(request, response);
      if (response.status === 204) return undefined as Result;

      const text = await response.text();
      if (text === "") return undefined as Result;
      try {
        return JSON.parse(text) as Result;
      } catch {
        fail("O backend respondeu com um corpo que não é JSON.", { path: request.path });
      }
    },

    async download(request: BackendRequest, { signal }: { signal: AbortSignal }): Promise<BackendFile> {
      const response = await dispatch(request, signal);
      if (!response.ok) await raise(request, response);

      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/iu.exec(disposition);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Base64 inflates by a third, and an oversized payload breaks the client
      // rather than the tool. Refuse it with an instruction the agent can act on.
      if (buffer.byteLength > config.maxExportBytes) {
        invalid(
          `O arquivo gerado tem ${Math.round(buffer.byteLength / 1024)} KB e excede o limite de ` +
            `${Math.round(config.maxExportBytes / 1024)} KB desta interface. Reduza o intervalo de datas ou filtre por situação.`,
        );
      }

      return {
        fileName: match?.[1] ?? "deuxorders-export",
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        base64: buffer.toString("base64"),
      };
    },
  };

  return gateway;
}
