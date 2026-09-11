import { describe, expect, it } from "vitest";
import { createDeuxOrdersEngine } from "../src/create-engine.js";
import { fakeBackend, anOrder } from "./support/fake-backend.js";

const principal = { id: "test:date-filters" };
const outputs = {
  "orders.search": { items: [], totalCount: 0, pageNumber: 1, pageSize: 10 },
  "dashboard.summary": { totalRevenue: 0, totalValue: 0, totalDiscount: 0, totalOrders: 0, pendingOrders: 0, completedOrders: 0, canceledOrders: 0, averageRevenuePerOrder: 0 },
  "dashboard.revenue-over-time": { dataPoints: [] },
  "dashboard.top-products": [],
  "dashboard.top-clients": [],
  "dashboard.export-orders": { fileName: "orders.csv", contentType: "text/csv", base64: "" },
};

describe.each(Object.keys(outputs) as Array<keyof typeof outputs>)("%s date and financial filters", (id) => {
  it.each([undefined, "CreatedAt"] as const)("uses delivery by default and allows creation (%s)", async (dateField) => {
    const backend = fakeBackend(() => outputs[id]);
    const engine = createDeuxOrdersEngine(backend);
    const input = { from: "2026-07-10", to: "2026-07-10", clientId: anOrder.clientId, isPaid: false, ...(dateField ? { dateField } : {}) };
    await engine.invoke(id, input, { principal });
    expect(backend.calls[0]?.request.query).toMatchObject({ ...input, dateField: dateField ?? "DeliveryDate" });
  });

  it.each([
    { from: "2026-07-20", to: "2026-07-10" },
    { from: "2026-02-30" },
    { createdAtFrom: "2026-07-10" },
    { deliveryFrom: "2026-07-10" },
    { dateField: "PaymentDate" },
  ])("rejects an invalid or unsupported filter before querying: %j", async (input) => {
    const backend = fakeBackend(() => outputs[id]);
    const engine = createDeuxOrdersEngine(backend);
    // Exercise runtime validation with deliberately invalid external inputs.
    await expect(engine.invoke(id, input as never, { principal })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(backend.calls).toHaveLength(0);
  });
});

it("forwards a product constraint together with date, payment and client filters", async () => {
  const backend = fakeBackend(() => outputs["orders.search"]);
  const engine = createDeuxOrdersEngine(backend);
  await engine.invoke("orders.search", { productId: anOrder.items[0]!.productId, clientId: anOrder.clientId, isPaid: true, dateField: "CreatedAt" }, { principal });
  expect(backend.calls[0]?.request.query).toMatchObject({ productId: anOrder.items[0]!.productId, clientId: anOrder.clientId, isPaid: true, dateField: "CreatedAt" });
});
