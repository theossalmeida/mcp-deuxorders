import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import { uuid } from "./shared.js";
import { orderPeriodFields as range, validOrderPeriod, orderPeriodValidation } from "./order-filters.js";

const topProductList = z.object({
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
  const summary = defineCapability({
    title: "Resumo do período",
    description:
      "Receita/faturamento e métricas de pedidos por data de entrega (padrão); use dateField=CreatedAt somente quando pedirem data de criação. from/to são dias inclusivos. Valores em centavos. totalRevenue é o valor após descontos, incluindo pedidos pagos e não pagos. Cancelados ficam fora de totalRevenue e totalOrders e são contados à parte em canceledOrders. Permite cliente, situação e pagamento.",
    input: z.strictObject(range).refine(validOrderPeriod, orderPeriodValidation),
    output: z.looseObject({
      totalRevenue: z.number().int(),
      totalValue: z.number().int(),
      totalDiscount: z.number().int(),
      totalOrders: z.number().int(),
      pendingOrders: z.number().int(),
      completedOrders: z.number().int(),
      canceledOrders: z.number().int(),
      averageRevenuePerOrder: z.number().int(),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: "/api/v1/dashboard/summary", query: { ...input } },
        { signal: context.signal },
      );
    },
  });

  const revenueOverTime = defineCapability({
    title: "Receita por dia",
    description:
      "Receita e número de pedidos por dia de entrega (padrão), no fuso de São Paulo. dateField=CreatedAt filtra e agrupa por criação. Mesmas regras do resumo; dias sem pedidos são omitidos. Valores em centavos. Para o total do período, use o resumo agregado.",
    input: z.strictObject(range).refine(validOrderPeriod, orderPeriodValidation),
    output: z.object({
      dataPoints: z.array(
        z.looseObject({
          date: z.string(),
          revenue: z.number().int(),
          orderCount: z.number().int(),
        }),
      ),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: "/api/v1/dashboard/revenue-over-time", query: { ...input } },
        { signal: context.signal },
      );
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
      const products = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/dashboard/top-products", query: { ...input } },
        { signal: context.signal },
      );
      return { products } as z.infer<typeof topProductList>;
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
      const clients = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/dashboard/top-clients", query: { ...input } },
        { signal: context.signal },
      );
      return { clients } as z.infer<typeof topClientList>;
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
      fileName: z.string(),
      contentType: z.string(),
      base64: z.string(),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.download(
        { method: "GET", path: "/api/v1/dashboard/export", query: { ...input } },
        { signal: context.signal },
      );
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
