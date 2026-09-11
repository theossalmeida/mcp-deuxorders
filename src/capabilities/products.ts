import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import {
  page,
  paged,
  pageSize,
  product,
  recipe,
  recipeOption,
  recipeOptionType,
  uuid,
} from "./shared.js";

const productOptions = z.object({
  products: z.array(
    z.looseObject({
      id: uuid,
      name: z.string(),
      price: z.number(),
      category: z.string().nullish(),
      size: z.string().nullish(),
    }),
  ),
});

const recipeItemInput = z.object({
  materialId: uuid,
  quantity: z.number().int().min(1),
});

export function createProductCapabilities(backend: BackendGateway) {
  const search = defineCapability({
    title: "Buscar produtos",
    description:
      "Lista produtos do catálogo com busca por nome e filtro de situação. Preços são em centavos.",
    input: z.object({
      search: z.string().trim().min(1).optional(),
      active: z.boolean().optional(),
      page,
      size: pageSize(100, 20),
    }),
    output: paged(product),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: "/api/v1/products/all",
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
    title: "Listar produtos para seleção",
    description:
      "Retorna id, nome, preço, categoria e tamanho de todos os produtos, sem paginação. Produtos com o mesmo nome se distinguem pelo tamanho.",
    input: z.object({ active: z.boolean().optional() }),
    output: productOptions,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const products = await backend.send<unknown>(
        { method: "GET", path: "/api/v1/products/dropdown", query: { status: input.active } },
        { signal: context.signal },
      );
      return { products } as z.infer<typeof productOptions>;
    },
  });

  const get = defineCapability({
    title: "Detalhar produto",
    description: "Retorna um produto do catálogo pelo id.",
    input: z.object({ productId: uuid }),
    output: product,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/products/${input.productId}` },
        { signal: context.signal },
      );
    },
  });

  const stats = defineCapability({
    title: "Vendas do produto no mês",
    description:
      "Quantidade vendida e receita em centavos de um produto num mês de entrega (padrão), ignorando pedidos e itens cancelados. Use dateField=CreatedAt somente quando pedirem por criação. Mês no fuso de São Paulo.",
    input: z.object({
      productId: uuid,
      month: z.string().regex(/^\d{4}-\d{2}$/u, "Use o formato YYYY-MM."),
      dateField: z.enum(["DeliveryDate", "CreatedAt"]).default("DeliveryDate"),
    }),
    output: z.looseObject({
      soldThisMonth: z.number().int(),
      revenueThisMonth: z.number().int(),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "GET",
          path: `/api/v1/products/${input.productId}/stats`,
          query: { month: input.month, dateField: input.dateField },
        },
        { signal: context.signal },
      );
    },
  });

  const create = defineCapability({
    title: "Cadastrar produto",
    description:
      "Cria um produto no catálogo. O preço é em centavos. A imagem não pode ser enviada por aqui — cadastre-a pelo aplicativo.",
    input: z.object({
      name: z.string().trim().min(1).max(100),
      price: z.number().int().min(0),
      description: z.string().trim().min(1).optional(),
      category: z.string().trim().min(1).optional(),
      size: z.string().trim().min(1).optional(),
    }),
    output: product,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "POST",
          path: "/api/v1/products/new",
          form: {
            Name: input.name,
            Price: input.price,
            Description: input.description,
            Category: input.category,
            Size: input.size,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const update = defineCapability({
    title: "Atualizar produto",
    description:
      "Atualiza um produto. Descrição, categoria e tamanho são sobrescritos: campos omitidos ficam vazios, então envie sempre os valores atuais que deseja manter. A imagem existente é preservada.",
    input: z.object({
      productId: uuid,
      name: z.string().trim().min(1).max(100),
      price: z.number().int().min(0),
      description: z.string().trim().min(1).optional(),
      category: z.string().trim().min(1).optional(),
      size: z.string().trim().min(1).optional(),
    }),
    output: product,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PUT",
          path: `/api/v1/products/${input.productId}`,
          form: {
            Name: input.name,
            Price: input.price,
            Description: input.description,
            Category: input.category,
            Size: input.size,
          },
        },
        { signal: context.signal },
      );
    },
  });

  const setStatus = defineCapability({
    title: "Ativar ou desativar produto",
    description:
      "Ativa ou desativa um produto. Produtos inativos não podem ser adicionados a pedidos. Falha se o produto já estiver na situação pedida.",
    input: z.object({ productId: uuid, active: z.boolean() }),
    output: product,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PATCH",
          path: `/api/v1/products/${input.productId}/${input.active ? "active" : "inactive"}`,
        },
        { signal: context.signal },
      );
    },
  });

  const remove = defineCapability({
    title: "Excluir produto",
    description:
      "Exclui um produto do catálogo. Falha se o produto tiver imagem ou pertencer a algum pedido; prefira desativar. Exige credencial de administrador no backend.",
    input: z.object({ productId: uuid }),
    output: z.object({ deleted: z.literal(true) }),
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    async run({ input, context }) {
      await backend.send(
        { method: "DELETE", path: `/api/v1/products/${input.productId}` },
        { signal: context.signal },
      );
      return { deleted: true as const };
    },
  });

  const getRecipe = defineCapability({
    title: "Ver receita do produto",
    description:
      "Retorna a receita padrão do produto: os materiais de estoque consumidos por unidade produzida.",
    input: z.object({ productId: uuid }),
    output: recipe,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/products/${input.productId}/recipe` },
        { signal: context.signal },
      );
    },
  });

  const setRecipe = defineCapability({
    title: "Definir receita do produto",
    description:
      "Substitui a receita padrão do produto. Uma lista vazia apaga a receita. Não repita o mesmo material e use apenas materiais ativos.",
    input: z.object({ productId: uuid, items: z.array(recipeItemInput) }),
    output: recipe,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PUT",
          path: `/api/v1/products/${input.productId}/recipe`,
          body: { items: input.items },
        },
        { signal: context.signal },
      );
    },
  });

  const listRecipeOptions = defineCapability({
    title: "Ver receitas por opção",
    description:
      "Lista as receitas específicas por massa, recheio e sabor do produto. Elas são usadas no lugar da receita padrão quando o item do pedido seleciona a opção.",
    input: z.object({ productId: uuid }),
    output: z.object({ options: z.array(recipeOption) }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/products/${input.productId}/recipe-options` },
        { signal: context.signal },
      );
    },
  });

  const setRecipeOption = defineCapability({
    title: "Definir receita de uma opção",
    description:
      "Cria ou substitui a receita de uma massa, recheio ou sabor do produto. Uma lista de materiais vazia apaga a opção. O par tipo + nome identifica a opção.",
    input: z.object({
      productId: uuid,
      type: recipeOptionType,
      name: z.string().trim().min(1).max(100),
      items: z.array(recipeItemInput),
    }),
    output: recipeOption,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        {
          method: "PUT",
          path: `/api/v1/products/${input.productId}/recipe-options`,
          body: { type: input.type, name: input.name, items: input.items },
        },
        { signal: context.signal },
      );
    },
  });

  const listOrderOptions = defineCapability({
    title: "Opções de massa e sabor para pedidos",
    description:
      "Catálogo fixo de massas de bolo, recheios, sabores de brigadeiro e sabores de cookie aceitos nos campos massa e sabor de um item de pedido.",
    input: z.object({ productId: uuid }),
    output: z.looseObject({
      cakeDoughs: z.array(z.string()),
      cakeFillings: z.array(z.string()),
      brigadeiroFlavors: z.array(z.string()),
      cookieFlavors: z.array(z.string()),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/products/${input.productId}/order-options` },
        { signal: context.signal },
      );
    },
  });

  return {
    "products.search": search,
    "products.list-options": listOptions,
    "products.get": get,
    "products.stats": stats,
    "products.create": create,
    "products.update": update,
    "products.set-status": setStatus,
    "products.delete": remove,
    "products.get-recipe": getRecipe,
    "products.set-recipe": setRecipe,
    "products.list-recipe-options": listRecipeOptions,
    "products.set-recipe-option": setRecipeOption,
    "products.list-order-options": listOrderOptions,
  };
}
