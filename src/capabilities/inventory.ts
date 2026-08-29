import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import { material, measureUnit, page, paged, pageSize, uuid } from "./shared.js";

const materialOptions = z.object({
  materials: z.array(z.looseObject({ id: uuid, name: z.string(), measureUnit })),
});

export function createInventoryCapabilities(backend: BackendGateway) {
  const search = defineCapability({
    title: "Buscar materiais de estoque",
    description:
      "Lista os materiais do estoque com busca por nome e filtro de situação. A quantidade pode ficar negativa quando um pedido consome mais do que havia. Custos em centavos.",
    input: z.object({
      search: z.string().trim().min(1).optional(),
      active: z.boolean().optional(),
      page,
      size: pageSize(100, 20),
    }),
    output: paged(material),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: "/api/v1/inventory/all",
          query: {
            search: input.search,
            status: input.active,
            page: input.page,
            size: input.size,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const listOptions = defineCapability({
    title: "Listar materiais para seleção",
    description:
      "Retorna id, nome e unidade de medida de todos os materiais, sem paginação. Use para montar receitas.",
    input: z.object({ active: z.boolean().optional() }),
    output: materialOptions,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const materials = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/inventory/dropdown", query: { status: input.active } },
        { signal: context.signal },
      );
      return { materials } as z.infer<typeof materialOptions>;
    },
  });

  const get = defineCapability({
    title: "Detalhar material",
    description: "Retorna um material do estoque pelo id, com quantidade e custo unitário atuais.",
    input: z.object({ materialId: uuid }),
    output: material,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/inventory/${input.materialId}` },
        { signal: context.signal },
      );
    },
  });

  const create = defineCapability({
    title: "Cadastrar material",
    description:
      "Cria um material no estoque com a quantidade e o custo total da primeira compra, em centavos. O custo unitário é calculado pelo backend.",
    input: z.object({
      name: z.string().trim().min(1).max(200),
      quantity: z.number().int().min(1),
      totalCost: z.number().int().min(1),
      measureUnit,
    }),
    output: material,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "POST", path: "/api/v1/inventory/new", body: { ...input } },
        { signal: context.signal },
      );
    },
  });

  const update = defineCapability({
    title: "Atualizar material",
    description:
      "Renomeia um material ou corrige sua unidade de medida. Quantidade e custo não mudam por aqui — use a reposição.",
    input: z.object({
      materialId: uuid,
      name: z.string().trim().min(1).max(200),
      measureUnit,
    }),
    output: material,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { materialId, ...body } = input;
      return backend.send(
        { method: "PUT", path: `/api/v1/inventory/${materialId}`, body },
        { signal: context.signal },
      );
    },
  });

  const restock = defineCapability({
    title: "Repor estoque de um material",
    description:
      "Registra uma compra: soma a quantidade ao estoque e recalcula o custo unitário pela média ponderada. O custo total é em centavos.",
    input: z.object({
      materialId: uuid,
      quantity: z.number().int().min(1),
      totalCost: z.number().int().min(1),
    }),
    output: material,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "POST",
          path: `/api/v1/inventory/${input.materialId}/restock`,
          body: { quantity: input.quantity, totalCost: input.totalCost },
        },
        { signal: context.signal },
      );
    },
  });

  const setStatus = defineCapability({
    title: "Ativar ou desativar material",
    description:
      "Ativa ou desativa um material. Materiais inativos não podem ser usados em receitas. Não existe exclusão de material. Falha se já estiver na situação pedida.",
    input: z.object({ materialId: uuid, active: z.boolean() }),
    output: material,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PATCH",
          path: `/api/v1/inventory/${input.materialId}/${input.active ? "active" : "inactive"}`,
        },
        { signal: context.signal },
      );
    },
  });

  return {
    "inventory.search": search,
    "inventory.list-options": listOptions,
    "inventory.get": get,
    "inventory.create": create,
    "inventory.update": update,
    "inventory.restock": restock,
    "inventory.set-status": setStatus,
  };
}
