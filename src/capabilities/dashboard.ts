import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import { uuid } from "./shared.js";
import { orderPeriodFields as range, validOrderPeriod, orderPeriodValidation } from "./order-filters.js";
import { resolveOrderQuery, resolvedPeriodSchema, withResolvedPeriod } from "./business-period.js";

const topProductList = z.object({
  resolvedPeriod: resolvedPeriodSchema.optional(),
  products: z.array(
    z.looseObject({
      productId: uuid,
      productName: z.string(),
      totalRevenue: z.number().int(),
      totalQuantitySold: z.number().int(),
      orderCount: z.number().int(),
    }),
  ),
});

const topClientList = z.object({
  resolvedPeriod: resolvedPeriodSchema.optional(),
  clients: z.array(
    z.looseObject({
      clientId: uuid,
      clientName: z.string(),
      totalRevenue: z.number().int(),
      orderCount: z.number().int(),
    }),
  ),
});

export function createDashboardCapabilities(backend: BackendGateway) {
  const summaryOutput = z.looseObject({
    resolvedPeriod: resolvedPeriodSchema.optional(),
    totalRevenue: z.number().int(),
    totalValue: z.number().int(),
    totalDiscount: z.number().int(),
    totalOrders: z.number().int(),
    pendingOrders: z.number().int(),
    completedOrders: z.number().int(),
    canceledOrders: z.number().int(),
    averageRevenuePerOrder: z.number().int(),
  });
  const revenueOutput = z.object({
    resolvedPeriod: resolvedPeriodSchema.optional(),
    dataPoints: z.array(z.looseObject({
      date: z.string(), revenue: z.number().int(), orderCount: z.number().int(),
    })),
  });
  const summary = defineCapability({
    title: "Resumo do período",
    description:
      "Receita/faturamento e métricas de pedidos por entrega (padrão); dateField=CreatedAt somente se pedirem criação. Para 'como foi a venda da semana?' envie period=this_week SEM from/to: o MCP calcula a semana atual em São Paulo. Semana passada=last_week. Use from/to inclusivos só para datas explícitas. Mostre o intervalo devolvido em resolvedPeriod. Valores em centavos; totalRevenue após descontos inclui pagos e não pagos. Cancelados ficam fora de totalRevenue e totalOrders e são contados em canceledOrders. Permite cliente, situação e pagamento.",
    input: z.strictObject(range).refine(validOrderPeriod, orderPeriodValidation),
    output: summaryOutput,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { query, resolvedPeriod } = resolveOrderQuery(input);
      const result = await backend.send<z.infer<typeof summaryOutput>>(
        { method: "GET", path: "/api/v1/dashboard/summary", query },
        { signal: context.signal },
      );
      return withResolvedPeriod(result, resolvedPeriod);
    },
  });

  const revenueOverTime = defineCapability({
    title: "Receita por dia",
    description:
      "Receita e número de pedidos por dia de entrega (padrão), no fuso de São Paulo. dateField=CreatedAt filtra e agrupa por criação. Mesmas regras do resumo; dias sem pedidos são omitidos. Valores em centavos. Para o total do período, use o resumo agregado.",
    input: z.strictObject(range).refine(validOrderPeriod, orderPeriodValidation),
    output: revenueOutput,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { query, resolvedPeriod } = resolveOrderQuery(input);
      const result = await backend.send<z.infer<typeof revenueOutput>>(
        { method: "GET", path: "/api/v1/dashboard/revenue-over-time", query },
        { signal: context.signal },
      );
      return withResolvedPeriod(result, resolvedPeriod);
    },
  });

  const topProducts = defineCapability({
    title: "Produtos mais vendidos",
    description:
      "Ranking de produtos por receita no período de entrega (padrão); dateField=CreatedAt usa criação. Ignora pedidos e itens cancelados. Valores em centavos. Permite cliente, situação e pagamento; limit controla o tamanho do ranking.",
    input: z.strictObject({ ...range, limit: z.number().int().min(1).max(100).default(10) }).refine(validOrderPeriod, orderPeriodValidation),
    output: topProductList,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { query, resolvedPeriod } = resolveOrderQuery(input);
      const products = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/dashboard/top-products", query },
        { signal: context.signal },
      );
      return withResolvedPeriod({ products }, resolvedPeriod) as z.infer<typeof topProductList>;
    },
  });

  const topClients = defineCapability({
    title: "Clientes que mais compraram",
    description:
      "Ranking de clientes por receita no período de entrega (padrão); dateField=CreatedAt usa criação. Ignora pedidos cancelados. Valores em centavos. Permite situação e pagamento; limit controla o tamanho do ranking.",
    input: z.strictObject({ ...range, limit: z.number().int().min(1).max(100).default(10) }).refine(validOrderPeriod, orderPeriodValidation),
    output: topClientList,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { query, resolvedPeriod } = resolveOrderQuery(input);
      const clients = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/dashboard/top-clients", query },
        { signal: context.signal },
      );
      return withResolvedPeriod({ clients }, resolvedPeriod) as z.infer<typeof topClientList>;
    },
  });

  const exportOrders = defineCapability({
    title: "Exportar pedidos",
    description:
      "Gera o relatório oficial de pedidos em CSV/PDF por entrega (padrão) ou criação (dateField=CreatedAt), com filtros de cliente, situação e pagamento. Uma linha por item não cancelado; segue as regras da exportação do SaaS. O arquivo volta em base64: entregue como arquivo, não reproduza o base64 na conversa. Limites: 10000 linhas CSV e 2000 PDF.",
    input: z.strictObject({
      ...range,
      format: z.enum(["csv", "pdf"]).default("csv"),
    }).refine(validOrderPeriod, orderPeriodValidation),
    output: z.object({
      resolvedPeriod: resolvedPeriodSchema.optional(),
      fileName: z.string(),
      contentType: z.string(),
      base64: z.string(),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { query, resolvedPeriod } = resolveOrderQuery(input);
      const result = await backend.download(
        { method: "GET", path: "/api/v1/dashboard/export", query },
        { signal: context.signal },
      );
      return withResolvedPeriod(result, resolvedPeriod);
    },
  });

  return {
    "dashboard.summary": summary,
    "dashboard.revenue-over-time": revenueOverTime,
    "dashboard.top-products": topProducts,
    "dashboard.top-clients": topClients,
    "dashboard.export-orders": exportOrders,
  };
}
