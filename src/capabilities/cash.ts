import { defineCapability } from "@invokta/core";
import { z } from "zod";

import type { BackendGateway } from "../application/ports.js";
import {
  cashEntry,
  cashFlowCategory,
  cashFlowSource,
  cashFlowType,
  isoDate,
  page,
  paged,
  pageSize,
  uuid,
} from "./shared.js";

const filters = {
  from: isoDate.optional().describe("Data de competência inicial, inclusiva."),
  to: isoDate.optional().describe("Data de competência final, inclusiva."),
  type: cashFlowType.optional(),
  category: cashFlowCategory.optional(),
  source: cashFlowSource.optional(),
};

const auditTrail = z.object({
  events: z.array(
    z.looseObject({
      id: uuid,
      entryId: uuid,
      occurredAt: isoDate,
      action: z.enum(["Created", "Updated", "Deleted"]),
      userId: uuid,
      userName: z.string(),
      snapshotJson: z.string(),
      previousSnapshotJson: z.string().nullish(),
    }),
  ),
});

export function createCashCapabilities(backend: BackendGateway) {
  const search = defineCapability({
    title: "Buscar lançamentos de caixa",
    description:
      "Lista lançamentos do fluxo de caixa por data de competência, tipo, categoria e origem, do mais recente para o mais antigo. Valores em centavos e sempre positivos — o sinal vem do tipo Inflow ou Outflow.",
    input: z.object({ ...filters, page, size: pageSize(100, 20) }),
    output: paged(cashEntry),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: "/api/v1/cash/entries", query: { ...input } },
        { signal: context.signal },
      );
    },
  });

  const get = defineCapability({
    title: "Detalhar lançamento de caixa",
    description: "Retorna um lançamento do fluxo de caixa pelo id.",
    input: z.object({ entryId: uuid }),
    output: cashEntry,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: `/api/v1/cash/entries/${input.entryId}` },
        { signal: context.signal },
      );
    },
  });

  const summary = defineCapability({
    title: "Resumo do caixa",
    description:
      "Totais de entrada, saída e saldo líquido do período, com quebra por categoria. Lançamentos excluídos são ignorados. Valores em centavos.",
    input: z.object(filters),
    output: z.looseObject({
      totalInflowCents: z.number().int(),
      totalOutflowCents: z.number().int(),
      netBalanceCents: z.number().int(),
      totalCount: z.number().int(),
      inflowByCategory: z.record(z.string(), z.number().int()),
      outflowByCategory: z.record(z.string(), z.number().int()),
    }),
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "GET", path: "/api/v1/cash/summary", query: { ...input } },
        { signal: context.signal },
      );
    },
  });

  const create = defineCapability({
    title: "Lançar entrada ou saída de caixa",
    description:
      "Cria um lançamento manual no fluxo de caixa. O valor é em centavos e sempre positivo; use o tipo Outflow para uma despesa. Exige credencial de administrador no backend.",
    input: z.object({
      billingDate: isoDate.describe("Data de competência do lançamento."),
      type: cashFlowType,
      category: cashFlowCategory,
      counterparty: z.string().trim().min(1).max(200),
      amountCents: z.number().int().min(1),
      notes: z.string().trim().max(2000).optional(),
    }),
    output: cashEntry,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    async run({ input, context }) {
      return backend.send(
        { method: "POST", path: "/api/v1/cash/entries", body: { ...input } },
        { signal: context.signal },
      );
    },
  });

  const update = defineCapability({
    title: "Atualizar lançamento de caixa",
    description:
      "Substitui os dados de um lançamento manual. Lançamentos gerados por pedidos não podem ser editados — reverta pelo pedido de origem. Exige credencial de administrador no backend.",
    input: z.object({
      entryId: uuid,
      billingDate: isoDate,
      type: cashFlowType,
      category: cashFlowCategory,
      counterparty: z.string().trim().min(1).max(200),
      amountCents: z.number().int().min(1),
      notes: z.string().trim().max(2000).optional(),
    }),
    output: cashEntry,
    access: "authenticated",
    annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const { entryId, ...body } = input;
      return backend.send(
        { method: "PUT", path: `/api/v1/cash/entries/${entryId}`, body },
        { signal: context.signal },
      );
    },
  });

  const remove = defineCapability({
    title: "Excluir lançamento de caixa",
    description:
      "Exclui um lançamento manual do fluxo de caixa. A exclusão é lógica e exige um motivo, que fica registrado na auditoria. Lançamentos gerados por pedidos não podem ser excluídos. Exige credencial de administrador no backend.",
    input: z.object({ entryId: uuid, reason: z.string().trim().min(5).max(500) }),
    output: z.object({ deleted: z.literal(true) }),
    access: "authenticated",
    annotations: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    async run({ input, context }) {
      await backend.send(
        {
          method: "DELETE",
          path: `/api/v1/cash/entries/${input.entryId}`,
          body: { reason: input.reason },
        },
        { signal: context.signal },
      );
      return { deleted: true as const };
    },
  });

  const audit = defineCapability({
    title: "Auditoria de um lançamento",
    description:
      "Histórico append-only de criação, alteração e exclusão de um lançamento de caixa, do mais antigo para o mais recente. Exige credencial de administrador no backend.",
    input: z.object({ entryId: uuid }),
    output: auditTrail,
    access: "authenticated",
    annotations: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    async run({ input, context }) {
      const events = await backend.send<unknown>(
        { method: "GET", path: `/api/v1/cash/audit/${input.entryId}` },
        { signal: context.signal },
      );
      return { events } as z.infer<typeof auditTrail>;
    },
  });

  return {
    "cash.search": search,
    "cash.get": get,
    "cash.summary": summary,
    "cash.create": create,
    "cash.update": update,
    "cash.delete": remove,
    "cash.audit": audit,
  };
}
