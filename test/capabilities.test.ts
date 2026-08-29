import { EngineError } from "@invokta/core";
import { describe, expect, it } from "vitest";

import { createDeuxOrdersEngine } from "../src/create-engine.js";
import { anOrder, fakeBackend } from "./support/fake-backend.js";

const principal = { id: "test:partner" };

function engineWith(handler: (request: unknown) => unknown) {
  const backend = fakeBackend(handler as never);
  return { engine: createDeuxOrdersEngine(backend), backend };
}

describe("capability surface", () => {
  it("exposes every domain and no generic http tool", () => {
    const { engine } = engineWith(() => ({}));
    const ids = engine.list().map((capability) => capability.id);

    expect(ids).toContain("orders.create");
    expect(ids).toContain("clients.search");
    expect(ids).toContain("dashboard.export-orders");
    expect(ids.some((id) => /request|call|query|endpoint/u.test(id))).toBe(false);
  });

  it("requires a principal on every capability", async () => {
    const { engine } = engineWith(() => anOrder);
    await expect(
      engine.invoke("orders.get", { orderId: anOrder.id }, { principal: null }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("orders", () => {
  it("creates an order through the backend contract", async () => {
    const { engine, backend } = engineWith(() => anOrder);

    const result = await engine.invoke(
      "orders.create",
      {
        clientId: anOrder.clientId,
        deliveryDate: "2026-09-01T00:00:00Z",
        items: [{ productId: anOrder.items[0]!.productId, quantity: 1, unitPrice: 12000 }],
      },
      { principal },
    );

    expect(result.id).toBe(anOrder.id);
    expect(backend.calls[0]!.request).toMatchObject({
      method: "POST",
      path: "/api/v1/orders/new",
    });
  });

  it("rejects invalid input before touching the backend", async () => {
    const { engine, backend } = engineWith(() => anOrder);

    await expect(
      engine.invoke(
        "orders.create",
        { clientId: "not-a-uuid", deliveryDate: "2026-09-01", items: [] },
        { principal },
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(backend.calls).toHaveLength(0);
  });

  it("translates the status name into the numeric code the backend expects", async () => {
    const { engine, backend } = engineWith(() => anOrder);

    await engine.invoke(
      "orders.update",
      { orderId: anOrder.id, status: "Preparing" },
      { principal },
    );

    expect(backend.calls[0]!.request.body).toMatchObject({ status: 5 });
  });

  it("normalizes the bare-order response into the warnings contract", async () => {
    const { engine } = engineWith(() => anOrder);

    const result = await engine.invoke(
      "orders.update",
      { orderId: anOrder.id, deliveryDate: "2026-09-02T00:00:00Z" },
      { principal },
    );

    expect(result.warnings).toEqual([]);
    expect(result.order.id).toBe(anOrder.id);
  });

  it("normalizes the wrapped response into the same contract", async () => {
    const { engine } = engineWith(() => ({
      response: anOrder,
      warnings: ["Material 'Farinha' ficou com estoque negativo: -3 g"],
    }));

    const result = await engine.invoke(
      "orders.adjust-item-quantity",
      { orderId: anOrder.id, productId: anOrder.items[0]!.productId, increment: 2 },
      { principal },
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.order.id).toBe(anOrder.id);
  });

  it("refuses a zero increment", async () => {
    const { engine } = engineWith(() => anOrder);

    await expect(
      engine.invoke(
        "orders.adjust-item-quantity",
        { orderId: anOrder.id, productId: anOrder.items[0]!.productId, increment: 0 },
        { principal },
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("surfaces a backend business rule as an input error", async () => {
    const { engine } = engineWith(() => {
      throw new EngineError({
        code: "INPUT_INVALID",
        message: "Não é possível cancelar um pedido já concluído.",
      });
    });

    await expect(
      engine.invoke("orders.cancel", { orderId: anOrder.id }, { principal }),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("surfaces a missing resource without leaking backend internals", async () => {
    const { engine } = engineWith(() => {
      throw new EngineError({
        code: "EXECUTION_FAILED",
        message: "Recurso não encontrado no DeuxOrders.",
        publicDetails: { reason: "not_found" },
      });
    });

    await expect(
      engine.invoke("orders.get", { orderId: anOrder.id }, { principal }),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
  });
});

describe("clients", () => {
  it("maps the active flag onto the backend status filter", async () => {
    const { engine, backend } = engineWith(() => ({
      items: [],
      totalCount: 0,
      pageNumber: 1,
      pageSize: 20,
    }));

    await engine.invoke("clients.search", { search: "ada", active: true }, { principal });

    expect(backend.calls[0]!.request.query).toMatchObject({ search: "ada", status: true });
  });

  it("routes set-status to the matching backend verb", async () => {
    const { engine, backend } = engineWith(() => ({ id: anOrder.clientId, name: "Ada" }));

    await engine.invoke(
      "clients.set-status",
      { clientId: anOrder.clientId, active: false },
      { principal },
    );

    expect(backend.calls[0]!.request.path).toBe(`/api/v1/clients/${anOrder.clientId}/inactive`);
  });
});

describe("dashboard", () => {
  it("returns an export as base64 with its file metadata", async () => {
    const { engine } = engineWith(() => ({
      fileName: "pedidos_20260828.csv",
      contentType: "text/csv; charset=utf-8",
      base64: "T3JkZXJJZA==",
    }));

    const result = await engine.invoke(
      "dashboard.export-orders",
      { from: "2026-08-01", to: "2026-08-31", format: "csv" },
      { principal },
    );

    expect(result.fileName).toBe("pedidos_20260828.csv");
    expect(Buffer.from(result.base64, "base64").toString()).toBe("OrderId");
  });
});

describe("output contract", () => {
  it("fails loudly when the backend returns an unexpected shape", async () => {
    const { engine } = engineWith(() => ({ unexpected: true }));

    await expect(
      engine.invoke("orders.get", { orderId: anOrder.id }, { principal }),
    ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
  });
});
