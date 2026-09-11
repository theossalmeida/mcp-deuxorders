import { z } from "zod";
import { orderStatus, uuid } from "./shared.js";

export const orderPeriodFields = {
  from: z.iso.date().optional().describe("Primeiro dia do período, inclusivo, AAAA-MM-DD no fuso America/Sao_Paulo."),
  to: z.iso.date().optional().describe("Último dia do período, inclusivo, AAAA-MM-DD no fuso America/Sao_Paulo. Não some um dia."),
  dateField: z.enum(["DeliveryDate", "CreatedAt"]).default("DeliveryDate")
    .describe("DeliveryDate (padrão): data de entrega. CreatedAt: data de criação, somente quando solicitada."),
  status: orderStatus.optional(),
  clientId: uuid.optional().describe("Restringe aos pedidos deste cliente; obtenha o id em uma busca."),
  isPaid: z.boolean().optional().describe("true: pagamento registrado; false: sem pagamento registrado. Omitir inclui ambos. Receita de pedidos não exige pagamento."),
};

export function validOrderPeriod(input: { from?: string | undefined; to?: string | undefined }): boolean {
  return input.from === undefined || input.to === undefined || input.from <= input.to;
}

export const orderPeriodValidation = {
  message: "A data inicial deve ser anterior ou igual à data final.",
  path: ["to"],
};
