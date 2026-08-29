import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import {
  isoDate,
  normalizeOrderResult,
  order,
  orderStatus,
  orderWithWarnings,
  page,
  paged,
  pageSize,
  uuid,
} from "./shared.js";

const statusCode: Record<z.infer<typeof orderStatus>, number> = {
  Pending: 1,
  Completed: 2,
  Canceled: 3,
  Received: 4,
  Preparing: 5,
  WaitingPickupOrDelivery: 6,
};

const newItem = z.object({
  productId: uuid,
  quantity: z.number().int().min(1),
  unitPrice: z.number().int().min(0).describe("Preço unitário pago, em centavos."),
  observation: z.string().max(500).optional(),
  massa: z.string().max(100).optional(),
  sabor: z.string().max(100).optional(),
});

const desiredItem = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).optional(),
  paidUnitPrice: z.number().int().min(0).optional(),
  observation: z.string().max(500).optional(),
  massa: z.string().max(100).optional(),
  sabor: z.string().max(100).optional(),
});

export function createOrderCapabilities(backend: BackendGateway) {
  const search = defineCapability({
    title: "Buscar pedidos",
    description:
      "Lista pedidos do DeuxOrders filtrando por situação, intervalo de data de entrega e texto livre (id do pedido ou nome do cliente). Ordenado do mais recente para o mais antigo.",
    input: z.object({
      search: z.string().trim().min(1).optional(),
      status: orderStatus.optional(),
      deliveryFrom: isoDate.optional().describe("Data de entrega inicial, inclusiva."),
      deliveryTo: isoDate.optional().describe("Data de entrega final, inclusiva."),
      page,
      size: pageSize(100, 10),
    }),
    output: paged(order),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: "/api/v1/orders/all",
          query: {
            search: input.search,
            status: input.status,
            from: input.deliveryFrom,
            to: input.deliveryTo,
            page: input.page,
            size: input.size,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const get = defineCapability({
    title: "Detalhar pedido",
    description:
      "Retorna um pedido completo com itens, valores em centavos e links temporários das imagens de referência.",
    input: z.object({ orderId: uuid }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/orders/${input.orderId}` },
        { signal: context.signal },
      );
    },
  });

  const create = defineCapability({
    title: "Criar pedido",
    description:
      "Cria um pedido para um cliente ativo com pelo menos um item. Preços são em centavos e podem divergir do catálogo — o preço do produto continua sendo a base para desconto. O pedido nasce com situação Received.",
    input: z.object({
      clientId: uuid,
      deliveryDate: isoDate,
      items: z.array(newItem).min(1),
    }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "POST",
          path: "/api/v1/orders/new",
          body: {
            clientId: input.clientId,
            deliveryDate: input.deliveryDate,
            items: input.items,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const update = defineCapability({
    title: "Atualizar pedido",
    description:
      "Atualiza data de entrega, situação e itens de um pedido. A lista de itens é o conjunto desejado completo: qualquer item ativo ausente da lista é cancelado. Mover o pedido para Preparing baixa os materiais da receita e pode retornar avisos de estoque.",
    input: z.object({
      orderId: uuid,
      deliveryDate: isoDate.optional(),
      status: orderStatus.optional(),
      items: z.array(desiredItem).optional(),
    }),
    output: orderWithWarnings,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      const payload = await backend.send<unknown>(
        {
          method: "PUT",
          path: `/api/v1/orders/${input.orderId}`,
          body: {
            deliveryDate: input.deliveryDate ?? null,
            status: input.status === undefined ? null : statusCode[input.status],
            items: input.items ?? null,
          },
        },
        { signal: context.signal },
      );
      return normalizeOrderResult(payload) as z.infer<typeof orderWithWarnings>;
    },
  });

  const complete = defineCapability({
    title: "Concluir pedido",
    description: "Marca o pedido como Completed. Não faz nada se já estiver concluído.",
    input: z.object({ orderId: uuid }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "PATCH", path: `/api/v1/orders/${input.orderId}/complete` },
        { signal: context.signal },
      );
    },
  });

  const cancel = defineCapability({
    title: "Cancelar pedido",
    description:
      "Cancela o pedido e devolve ao estoque os materiais já baixados. Pedidos concluídos não podem ser cancelados.",
    input: z.object({ orderId: uuid }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "PATCH", path: `/api/v1/orders/${input.orderId}/cancel` },
        { signal: context.signal },
      );
    },
  });

  const cancelItem = defineCapability({
    title: "Cancelar item do pedido",
    description:
      "Cancela um item específico do pedido. Itens cancelados saem dos totais e dos relatórios. Não funciona em pedidos concluídos ou cancelados.",
    input: z.object({ orderId: uuid, productId: uuid }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PATCH",
          path: `/api/v1/orders/${input.orderId}/items/${input.productId}/cancel`,
        },
        { signal: context.signal },
      );
    },
  });

  const adjustItemQuantity = defineCapability({
    title: "Ajustar quantidade de um item",
    description:
      "Soma um incremento à quantidade de um item do pedido. Use valores negativos para reduzir. Zerar a quantidade não é permitido — cancele o item. Pode retornar avisos de estoque.",
    input: z.object({
      orderId: uuid,
      productId: uuid,
      increment: z.number().int().refine((value) => value !== 0, "O incremento não pode ser zero."),
    }),
    output: orderWithWarnings,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      const payload = await backend.send<unknown>(
        {
          method: "PATCH",
          path: `/api/v1/orders/${input.orderId}/items/${input.productId}/quantity`,
          body: { increment: input.increment },
        },
        { signal: context.signal },
      );
      return normalizeOrderResult(payload) as z.infer<typeof orderWithWarnings>;
    },
  });

  const markPaid = defineCapability({
    title: "Marcar pedido como pago",
    description:
      "Registra o pagamento do pedido e gera automaticamente a entrada correspondente no fluxo de caixa. Exige credencial de administrador no backend.",
    input: z.object({ orderId: uuid }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "PATCH", path: `/api/v1/orders/${input.orderId}/pay` },
        { signal: context.signal },
      );
    },
  });

  const reversePayment = defineCapability({
    title: "Reverter pagamento do pedido",
    description:
      "Desfaz o pagamento de um pedido e lança a reversão no fluxo de caixa. Exige um motivo e credencial de administrador no backend.",
    input: z.object({
      orderId: uuid,
      reason: z.string().trim().min(5).max(500),
    }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PATCH",
          path: `/api/v1/orders/${input.orderId}/unpay`,
          body: { reason: input.reason },
        },
        { signal: context.signal },
      );
    },
  });

  const removeReference = defineCapability({
    title: "Remover imagem de referência",
    description:
      "Remove uma imagem de referência do pedido pela chave do objeto no armazenamento.",
    input: z.object({ orderId: uuid, objectKey: z.string().trim().min(1).max(500) }),
    output: order,
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "DELETE",
          path: `/api/v1/orders/${input.orderId}/references`,
          body: { objectKey: input.objectKey },
        },
        { signal: context.signal },
      );
    },
  });

  return {
    "orders.search": search,
    "orders.get": get,
    "orders.create": create,
    "orders.update": update,
    "orders.complete": complete,
    "orders.cancel": cancel,
    "orders.cancel-item": cancelItem,
    "orders.adjust-item-quantity": adjustItemQuantity,
    "orders.mark-paid": markPaid,
    "orders.reverse-payment": reversePayment,
    "orders.remove-reference": removeReference,
  };
}
