import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBackendGateway } from "../src/infrastructure/backend-gateway.js";

const config = {
  baseUrl: "https://backend.test",
  serviceEmail: "mcp@deuxorders.test",
  servicePassword: "s3cret-value",
  timeoutMs: 1_000,
  retries: 1,
  maxExportBytes: 1_024,
};

const signal = new AbortController().signal;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Each call needs its own Response: a body can only be read once. */
function always(body: unknown, status = 200) {
  return () => Promise.resolve(json(body, status));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function loginOnce(): void {
  fetchMock.mockResolvedValueOnce(json({ token: "jwt-1" }));
}

describe("backend gateway", () => {
  it("logs in once and reuses the token across calls", async () => {
    fetchMock.mockImplementationOnce(always({ token: "jwt-1" }));
    fetchMock.mockImplementation(always({ ok: true }));
    const gateway = createBackendGateway(config);

    await gateway.send({ method: "GET", path: "/api/v1/orders/all" }, { signal });
    await gateway.send({ method: "GET", path: "/api/v1/clients/all" }, { signal });

    const logins = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/login"));
    expect(logins).toHaveLength(1);
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe("Bearer jwt-1");
  });

  it("never puts the service credential in the outgoing request", async () => {
    fetchMock.mockImplementationOnce(always({ token: "jwt-1" }));
    fetchMock.mockImplementation(always({ ok: true }));
    const gateway = createBackendGateway(config);

    await gateway.send(
      { method: "POST", path: "/api/v1/clients/new", body: { name: "Ada" } },
      { signal },
    );

    const serialized = JSON.stringify(fetchMock.mock.calls[1]);
    expect(serialized).not.toContain(config.servicePassword);
    expect(serialized).not.toContain(config.serviceEmail);
  });

  it("re-authenticates once when the backend rejects a stale token", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(json({}, 401));
    fetchMock.mockResolvedValueOnce(json({ token: "jwt-2" }));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "GET", path: "/api/v1/orders/all" }, { signal }),
    ).resolves.toEqual({ ok: true });
  });

  it("maps a validation problem to INPUT_INVALID with the backend message", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(
      json({ title: "Erro de Validação de Negócio", status: 400, detail: "Cliente inexistente ou inativo." }, 400),
    );
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "POST", path: "/api/v1/orders/new", body: {} }, { signal }),
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: "Cliente inexistente ou inativo.",
    });
  });

  it("flattens a FluentValidation errors dictionary into one message", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(
      json({ errors: { Name: ["O nome do cliente é obrigatório."] } }, 400),
    );
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "POST", path: "/api/v1/clients/new", body: {} }, { signal }),
    ).rejects.toMatchObject({ message: "O nome do cliente é obrigatório." });
  });

  it("marks a missing resource so the agent can react", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "GET", path: "/api/v1/orders/x" }, { signal }),
    ).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
      publicDetails: { reason: "not_found" },
    });
  });

  it("hides a backend 500 body from the caller", async () => {
    fetchMock.mockImplementationOnce(always({ token: "jwt-1" }));
    fetchMock.mockImplementation(always({ detail: "stack trace and table names" }, 500));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "POST", path: "/api/v1/orders/new", body: {} }, { signal }),
    ).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
      message: "O DeuxOrders não conseguiu completar a operação.",
    });
  });

  it("retries a failed read and gives up with a clear error", async () => {
    fetchMock.mockImplementationOnce(always({ token: "jwt-1" }));
    fetchMock.mockImplementation(always({}, 503));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "GET", path: "/api/v1/orders/all" }, { signal }),
    ).rejects.toMatchObject({ publicDetails: { reason: "unavailable", status: 503 } });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/orders/all"))).toHaveLength(2);
  });

  it("does not retry a write", async () => {
    fetchMock.mockImplementationOnce(always({ token: "jwt-1" }));
    fetchMock.mockImplementation(always({}, 503));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "POST", path: "/api/v1/orders/new", body: {} }, { signal }),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/orders/new"))).toHaveLength(1);
  });

  it("reports an unreachable backend rather than hanging", async () => {
    loginOnce();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "POST", path: "/api/v1/orders/new", body: {} }, { signal }),
    ).rejects.toMatchObject({ message: "O backend do DeuxOrders está inacessível." });
  });

  it("rejects a response body that is not JSON", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "GET", path: "/api/v1/orders/all" }, { signal }),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
  });

  it("drops empty query values instead of sending them", async () => {
    fetchMock.mockImplementationOnce(always({ token: "jwt-1" }));
    fetchMock.mockImplementation(always({ ok: true }));
    const gateway = createBackendGateway(config);

    await gateway.send(
      { method: "GET", path: "/api/v1/orders/all", query: { search: undefined, page: 1 } },
      { signal },
    );

    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://backend.test/api/v1/orders/all?page=1");
  });

  it("returns a download with its filename and content type", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(
      new Response("OrderId", {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="pedidos_20260828.csv"',
        },
      }),
    );
    const gateway = createBackendGateway(config);

    const file = await gateway.download(
      { method: "GET", path: "/api/v1/dashboard/export" },
      { signal },
    );

    expect(file.fileName).toBe("pedidos_20260828.csv");
    expect(file.contentType).toContain("text/csv");
    expect(Buffer.from(file.base64, "base64").toString()).toBe("OrderId");
  });

  it("refuses an export that is too large to return, with an actionable message", async () => {
    loginOnce();
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(config.maxExportBytes + 1), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="pedidos.csv"' },
      }),
    );
    const gateway = createBackendGateway(config);

    await expect(
      gateway.download({ method: "GET", path: "/api/v1/dashboard/export" }, { signal }),
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("Reduza o intervalo"),
    });
  });

  it("does not expose a rejected service credential as a caller error", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401));
    const gateway = createBackendGateway(config);

    await expect(
      gateway.send({ method: "GET", path: "/api/v1/orders/all" }, { signal }),
    ).rejects.toMatchObject({ publicDetails: { reason: "service_credential" } });
  });
});
