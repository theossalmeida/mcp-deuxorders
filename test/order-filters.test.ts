import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => vi.useRealTimers());

describe.each(Object.keys(outputs) as Array<keyof typeof outputs>)("%s date and financial filters", (id) => {
  it.each([
    ["this_week", "2026-09-07", "2026-09-11"],
    ["last_week", "2026-08-31", "2026-09-06"],
    ["this_month", "2026-09-01", "2026-09-11"],
    ["last_month", "2026-08-01", "2026-08-31"],
    ["this_year", "2026-01-01", "2026-09-11"],
    ["last_year", "2025-01-01", "2025-12-31"],
  ] as const)("resolves %s from the clock and returns the applied dates", async (period, from, to) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T20:00:00Z"));
    const backend = fakeBackend(() => outputs[id]);
    const engine = createDeuxOrdersEngine(backend);
    const result = await engine.invoke(id, { period, dateField: "CreatedAt", isPaid: false }, { principal });
    expect(backend.calls[0]?.request.query).toMatchObject({ from, to, dateField: "CreatedAt", isPaid: false });
    expect(backend.calls[0]?.request.query).not.toHaveProperty("period");
    expect(backend.calls[0]?.request.query).not.toHaveProperty("days");
    expect(result).toMatchObject({ resolvedPeriod: { period, from, to, referenceDate: "2026-09-11", timeZone: "America/Sao_Paulo" } });
  });

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
    { period: "this_week", from: "2026-08-24", to: "2026-08-30" },
    { period: "last_n_days" },
    { period: "this_week", days: 7 },
    { days: 7 },
    { period: "last_n_days", days: 0 },
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
