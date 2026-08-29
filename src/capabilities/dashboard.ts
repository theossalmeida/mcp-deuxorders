import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import { isoDate, orderStatus, uuid } from "./shared.js";

const range = {
  createdAtFrom: isoDate.optional().describe("Data de criação inicial, inclusiva."),
  createdAtTo: isoDate.optional().describe("Data de criação final, exclusiva."),
  status: orderStatus.optional(),
};

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
      "Métricas agregadas de pedidos num intervalo: receita, valor de tabela, desconto, contagens por situação e ticket médio. Todos os valores em centavos. Pedidos cancelados ficam fora da receita e são contados à parte.",
    input: z.object(range),
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
      "Receita e número de pedidos por dia no fuso de São Paulo. Dias sem pedidos são omitidos. Valores em centavos.",
    input: z.object(range),
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
      "Ranking de produtos por receita no período, ignorando pedidos e itens cancelados. Valores em centavos.",
    input: z.object({ ...range, limit: z.number().int().min(1).max(100).default(10) }),
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
      "Ranking de clientes por receita no período, ignorando pedidos cancelados. Valores em centavos.",
    input: z.object({ ...range, limit: z.number().int().min(1).max(100).default(10) }),
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
      "Gera o relatório oficial de pedidos do DeuxOrders em CSV ou PDF, uma linha por item não cancelado, filtrado por data de entrega. O arquivo volta codificado em base64. Limites do backend: 10000 linhas em CSV e 2000 em PDF.",
    input: z.object({
      from: isoDate.optional().describe("Data de entrega inicial, inclusiva."),
      to: isoDate.optional().describe("Data de entrega final, inclusiva."),
      status: orderStatus.optional(),
      format: z.enum(["csv", "pdf"]).default("csv"),
    }),
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
