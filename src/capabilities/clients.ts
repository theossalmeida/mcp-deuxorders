import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import {
  client,
  clientStats,
  isoDate,
  order,
  page,
  paged,
  pageSize,
  uuid,
} from "./shared.js";

const listedClient = client.extend({
  status: z.boolean(),
  totalOrders: z.number().int().nullish(),
  totalSpent: z.number().int().nullish(),
});

const clientOptions = z.object({
  clients: z.array(z.object({ id: uuid, name: z.string() })),
});

export function createClientCapabilities(backend: BackendGateway) {
  const search = defineCapability({
    title: "Buscar clientes",
    description:
      "Lista clientes do DeuxOrders com busca por nome e filtro de situação. Use para descobrir o id de um cliente antes de outras operações.",
    input: z.object({
      search: z.string().trim().min(1).optional(),
      active: z.boolean().optional(),
      page,
      size: pageSize(100, 20),
      includeTotals: z.boolean().default(false),
    }),
    output: paged(listedClient),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: "/api/v1/clients/all",
          query: {
            search: input.search,
            status: input.active,
            page: input.page,
            size: input.size,
            includeTotals: input.includeTotals,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const listOptions = defineCapability({
    title: "Listar clientes para seleção",
    description:
      "Retorna apenas id e nome de todos os clientes, sem paginação. Use quando precisar mapear nomes para ids em lote.",
    input: z.object({ active: z.boolean().optional() }),
    output: clientOptions,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const clients = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/clients/dropdown", query: { status: input.active } },
        { signal: context.signal },
      );
      return { clients } as z.infer<typeof clientOptions>;
    },
  });

  const get = defineCapability({
    title: "Detalhar cliente",
    description:
      "Retorna um cliente do DeuxOrders com estatísticas de compra e, opcionalmente, o histórico paginado de pedidos.",
    input: z.object({
      clientId: uuid,
      includeOrders: z.boolean().default(false),
      includeStats: z.boolean().default(true),
      page,
      size: pageSize(100, 20),
    }),
    output: z.looseObject({
      id: uuid,
      name: z.string(),
      mobile: z.string().nullish(),
      status: z.boolean(),
      stats: clientStats.nullish(),
      orders: paged(order).nullish(),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: `/api/v1/clients/${input.clientId}`,
          query: {
            orders: input.includeOrders,
            includeStats: input.includeStats,
            page: input.page,
            size: input.size,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const stats = defineCapability({
    title: "Estatísticas do cliente",
    description:
      "Total de pedidos, total gasto em centavos e data do último pedido de um cliente. Pedidos cancelados são ignorados.",
    input: z.object({ clientId: uuid }),
    output: clientStats,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/clients/${input.clientId}/stats` },
        { signal: context.signal },
      );
    },
  });

  const listOrders = defineCapability({
    title: "Pedidos de um cliente",
    description:
      "Histórico paginado de pedidos de um cliente, do mais recente para o mais antigo, incluindo cancelados.",
    input: z.object({ clientId: uuid, page, size: pageSize(100, 20) }),
    output: paged(order),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: `/api/v1/clients/${input.clientId}/orders`,
          query: { page: input.page, size: input.size },
        },
        { signal: context.signal },
      );
    },
  });

  const create = defineCapability({
    title: "Cadastrar cliente",
    description: "Cria um cliente no DeuxOrders. O cliente nasce ativo.",
    input: z.object({
      name: z.string().trim().min(1).max(150),
      mobile: z.string().trim().max(20).optional(),
    }),
    output: client,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "POST",
          path: "/api/v1/clients/new",
          body: { name: input.name, mobile: input.mobile ?? null },
        },
        { signal: context.signal },
      );
    },
  });

  const update = defineCapability({
    title: "Atualizar cliente",
    description:
      "Atualiza nome, telefone e situação de um cliente. Omitir o telefone apaga o telefone gravado, então envie o valor atual quando quiser mantê-lo.",
    input: z.object({
      clientId: uuid,
      name: z.string().trim().min(1).max(150),
      mobile: z.string().trim().max(20).optional(),
      active: z.boolean().optional(),
    }),
    output: client,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PUT",
          path: `/api/v1/clients/${input.clientId}`,
          body: {
            name: input.name,
            mobile: input.mobile ?? null,
            status: input.active ?? null,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const setStatus = defineCapability({
    title: "Ativar ou desativar cliente",
    description:
      "Ativa ou desativa um cliente. Clientes inativos não podem receber novos pedidos. Falha se o cliente já estiver na situação pedida.",
    input: z.object({ clientId: uuid, active: z.boolean() }),
    output: client,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PATCH",
          path: `/api/v1/clients/${input.clientId}/${input.active ? "active" : "inactive"}`,
        },
        { signal: context.signal },
      );
    },
  });

  const remove = defineCapability({
    title: "Excluir cliente",
    description:
      "Exclui um cliente definitivamente. Só funciona para clientes sem pedidos vinculados; prefira desativar. Exige credencial de administrador no backend.",
    input: z.object({ clientId: uuid }),
    output: z.object({ deleted: z.literal(true) }),
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    async run({ input, context }) {
      await backend.send(
        { method: "DELETE", path: `/api/v1/clients/${input.clientId}` },
        { signal: context.signal },
      );
      return { deleted: true as const };
    },
  });

  const crmList = defineCapability({
    title: "Carteira de clientes (CRM)",
    description:
      "Clientes com pelo menos um pedido não cancelado, agregados por gasto total, ticket médio e data do último pedido, ordenados do último pedido mais antigo para o mais recente. Use os filtros de data para achar quem não compra há um tempo. Pedidos cancelados são ignorados.",
    input: z.object({
      search: z.string().trim().min(1).optional(),
      lastOrderFrom: isoDate.optional(),
      lastOrderTo: isoDate.optional(),
      page,
      size: pageSize(500, 20),
    }),
    output: paged(
      z.looseObject({
        clientId: uuid,
        name: z.string(),
        mobile: z.string().nullish(),
        orderCount: z.number().int(),
        averageSpend: z.number().int(),
        totalSpend: z.number().int(),
        lastOrderDate: isoDate,
        lastOrderInfo: z.looseObject({
          products: z.array(z.string()),
          totalSpend: z.number().int(),
        }),
      }),
    ),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: "/api/v1/crm/list",
          query: {
            search: input.search,
            lastOrderFrom: input.lastOrderFrom,
            lastOrderTo: input.lastOrderTo,
            page: input.page,
            size: input.size,
          },
        },
        { signal: context.signal },
      );
    },
  });

  return {
    "clients.search": search,
    "clients.list-options": listOptions,
    "clients.get": get,
    "clients.stats": stats,
    "clients.list-orders": listOrders,
    "clients.create": create,
    "clients.update": update,
    "clients.set-status": setStatus,
    "clients.delete": remove,
    "crm.list": crmList,
  };
}
