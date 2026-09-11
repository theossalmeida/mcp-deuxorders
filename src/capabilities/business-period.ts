import { z } from "zod";

export const relativePeriod = z.enum([
  "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year", "last_n_days",
]);

export const resolvedPeriodSchema = z.object({
  period: relativePeriod,
  referenceDate: z.iso.date(),
  from: z.iso.date(),
  to: z.iso.date(),
  timeZone: z.literal("America/Sao_Paulo"),
});

export type PeriodInput = {
  period?: z.infer<typeof relativePeriod> | undefined;
  days?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export function resolveOrderQuery<T extends PeriodInput>(input: T, now = new Date()) {
  const { period, days, ...query } = input;
  if (period === undefined) return { query, resolvedPeriod: undefined };

  const referenceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  // UTC is used only for calendar arithmetic, after choosing the local date.
  const today = new Date(`${referenceDate}T00:00:00Z`);
  const from = new Date(today);
  const to = new Date(today);
  const weekday = (today.getUTCDay() + 6) % 7;
  switch (period) {
    case "today": break;
    case "yesterday": from.setUTCDate(from.getUTCDate() - 1); to.setUTCDate(to.getUTCDate() - 1); break;
    case "this_week": from.setUTCDate(from.getUTCDate() - weekday); break;
    case "last_week":
      from.setUTCDate(from.getUTCDate() - weekday - 7);
      to.setUTCDate(to.getUTCDate() - weekday - 1);
      break;
    case "this_month": from.setUTCDate(1); break;
    case "last_month":
      from.setUTCDate(1); from.setUTCMonth(from.getUTCMonth() - 1);
      to.setUTCDate(0);
      break;
    case "this_year": from.setUTCMonth(0, 1); break;
    case "last_year":
      from.setUTCFullYear(from.getUTCFullYear() - 1, 0, 1);
      to.setUTCMonth(0, 0);
      break;
    case "last_n_days":
      if (days === undefined || !Number.isInteger(days) || days < 1 || days > 3660)
        throw new Error("last_n_days exige days entre 1 e 3660.");
      from.setUTCDate(from.getUTCDate() - days + 1);
      break;
  }
  const bounds = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  return {
    query: { ...query, ...bounds },
    resolvedPeriod: { period, referenceDate, ...bounds, timeZone: "America/Sao_Paulo" as const },
  };
}

export function withResolvedPeriod<T>(result: T, resolvedPeriod: z.infer<typeof resolvedPeriodSchema> | undefined) {
  return resolvedPeriod === undefined ? result : { ...result, resolvedPeriod };
}
