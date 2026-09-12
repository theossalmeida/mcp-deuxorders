import { z } from "zod";

export const uuid = z.string().uuid();
export const isoDate = z.string().min(1);

export const orderStatus = z.enum([
  "Pending",
  "Completed",
  "Canceled",
  "Received",
  "Preparing",
  "WaitingPickupOrDelivery",
]);

export const cashFlowType = z.enum(["Inflow", "Outflow"]);

export const cashFlowCategory = z.enum([
  "Order",
  "OrderReversal",
  "RawMaterial",
  "Supplier",
  "Salary",
  "Tax",
  "Utilities",
  "Equipment",
  "Marketing",
  "Other",
]);

export const cashFlowSource = z.enum(["Manual", "OrderPayment", "OrderReversal"]);

export const measureUnit = z.enum(["ML", "G", "U"]);

export const recipeOptionType = z.enum(["Dough", "Filling", "Flavor"]);

export const page = z.number().int().min(1).default(1);

export function pageSize(max: number, fallback: number) {
  return z.number().int().min(1).max(max).default(fallback);
}

export function paged<Item extends z.ZodTypeAny>(item: Item) {
  return z.object({
    items: z.array(item),
    totalCount: z.number().int(),
    pageNumber: z.number().int(),
    pageSize: z.number().int(),
  });
}

export const orderItem = z.looseObject({
  productId: uuid,
  productName: z.string(),
  productSize: z.string().nullish(),
  observation: z.string().nullish(),
  massa: z.string().nullish(),
  sabor: z.string().nullish(),
  quantity: z.number().int(),
  paidUnitPrice: z.number().int(),
  baseUnitPrice: z.number().int(),
  itemCanceled: z.boolean(),
  totalPaid: z.number().int(),
  totalValue: z.number().int(),
});

export const order = z.looseObject({
  id: uuid,
  createdAt: isoDate.optional(),
  deliveryDate: isoDate,
  status: z.string(),
  clientId: uuid,
  clientName: z.string(),
  clientMobile: z.string().nullish(),
  totalPaid: z.number().int(),
  totalValue: z.number().int(),
  references: z.array(z.string()).nullish(),
  items: z.array(orderItem),
  paidAt: isoDate.nullish(),
  paidByUserName: z.string().nullish(),
});

export const orderWithWarnings = z.object({
  order,
  warnings: z.array(z.string()),
});

export const client = z.looseObject({
  id: uuid,
  name: z.string(),
  mobile: z.string().nullish(),
});

export const clientStats = z.looseObject({
  totalOrders: z.number().int(),
  totalSpent: z.number().int(),
  lastOrderDate: isoDate.nullish(),
});

export const product = z.looseObject({
  id: uuid,
  name: z.string(),
  price: z.number().int(),
  status: z.boolean(),
  image: z.string().nullish(),
  category: z.string().nullish(),
  size: z.string().nullish(),
});

export const recipeItem = z.looseObject({
  materialId: uuid,
  materialName: z.string(),
  quantity: z.number().int(),
  measureUnit: z.string(),
});

export const recipe = z.looseObject({
  hasRecipe: z.boolean(),
  items: z.array(recipeItem),
});

export const recipeOption = z.looseObject({
  id: uuid,
  type: recipeOptionType,
  name: z.string(),
  hasRecipe: z.boolean(),
  items: z.array(recipeItem),
});

export const cashEntry = z.looseObject({
  id: uuid,
  createdAt: isoDate,
  billingDate: isoDate,
  type: cashFlowType,
  category: z.string(),
  counterparty: z.string(),
  amountCents: z.number().int(),
  notes: z.string().nullish(),
  source: cashFlowSource,
  sourceId: uuid.nullish(),
  authorUserId: uuid,
  authorUserName: z.string(),
  updatedAt: isoDate.nullish(),
  deletedAt: isoDate.nullish(),
});

export const material = z.looseObject({
  id: uuid,
  name: z.string(),
  quantity: z.number().int(),
  unitCost: z.number().int(),
  measureUnit: measureUnit,
  status: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/**
 * The backend answers order mutations either with the order itself or with
 * { response, warnings }. Both shapes reach the agent as one stable contract.
 */
export function normalizeOrderResult(payload: unknown): {
  order: unknown;
  warnings: string[];
} {
  if (typeof payload === "object" && payload !== null && "response" in payload) {
    const wrapped = payload as { response: unknown; warnings?: unknown };
    return {
      order: wrapped.response,
      warnings: Array.isArray(wrapped.warnings)
        ? wrapped.warnings.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  }
  return { order: payload, warnings: [] };
}
