import { describe, expect, it } from "vitest";
import { resolveOrderQuery, type PeriodInput } from "../src/capabilities/business-period.js";

describe("business calendar boundaries", () => {
  it.each([
    ["today", "2026-09-12T02:59:59Z", "2026-09-11", "2026-09-11"],
    ["today", "2026-09-12T03:00:00Z", "2026-09-12", "2026-09-12"],
    ["yesterday", "2026-01-01T15:00:00Z", "2025-12-31", "2025-12-31"],
    ["this_week", "2026-09-07T03:00:00Z", "2026-09-07", "2026-09-07"],
    ["this_week", "2026-09-14T02:59:59Z", "2026-09-07", "2026-09-13"],
    ["last_week", "2026-01-01T15:00:00Z", "2025-12-22", "2025-12-28"],
    ["last_month", "2026-01-01T15:00:00Z", "2025-12-01", "2025-12-31"],
    ["last_month", "2024-03-31T15:00:00Z", "2024-02-01", "2024-02-29"],
    ["this_year", "2027-01-01T02:59:59Z", "2026-01-01", "2026-12-31"],
    ["last_year", "2027-01-01T03:00:00Z", "2026-01-01", "2026-12-31"],
  ] as const)("%s at %s resolves %s through %s", (period, now, from, to) => {
    expect(resolveOrderQuery({ period }, new Date(now)).query).toEqual({ from, to });
  });

  it("includes today in the last N days and preserves other filters", () => {
    expect(resolveOrderQuery({ period: "last_n_days", days: 7, dateField: "DeliveryDate" }, new Date("2026-09-11T15:00:00Z")).query)
      .toEqual({ from: "2026-09-05", to: "2026-09-11", dateField: "DeliveryDate" });
  });

  it("resolves a new request again when the local date rolls over", () => {
    const input: PeriodInput = { period: "this_week" };
    expect(resolveOrderQuery(input, new Date("2026-09-14T02:59:59Z")).query).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    expect(resolveOrderQuery(input, new Date("2026-09-14T03:00:00Z")).query).toEqual({ from: "2026-09-14", to: "2026-09-14" });
  });
});
