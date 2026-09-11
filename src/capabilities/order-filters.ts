import { z } from "zod";
import { orderStatus, uuid } from "./shared.js";
import { relativePeriod, type PeriodInput } from "./business-period.js";

export const orderPeriodFields = {
  period: relativePeriod.optional().describe("Para datas relativas, use ESTE campo e omita from/to. 'Venda da semana', 'esta semana' = this_week (segunda até hoje); semana passada = last_week; hoje=today; ontem=yesterday; este mês=this_month; mês passado=last_month; este ano=this_year; ano passado=last_year; últimos N dias=last_n_days com days=N. Período atual termina hoje; anterior é completo. O MCP calcula pelo relógio atual de São Paulo; nunca reutilize datas do histórico."),
  days: z.number().int().min(1).max(3660).optional().describe("Número de dias incluindo hoje; obrigatório somente com period=last_n_days."),
  from: z.iso.date().optional().describe("Primeiro dia do período, inclusivo, AAAA-MM-DD no fuso America/Sao_Paulo."),
  to: z.iso.date().optional().describe("Último dia do período, inclusivo, AAAA-MM-DD no fuso America/Sao_Paulo. Não some um dia."),
  dateField: z.enum(["DeliveryDate", "CreatedAt"]).default("DeliveryDate")
    .describe("DeliveryDate (padrão): data de entrega. CreatedAt: data de criação, somente quando solicitada."),
  status: orderStatus.optional(),
  clientId: uuid.optional().describe("Restringe aos pedidos deste cliente; obtenha o id em uma busca."),
  isPaid: z.boolean().optional().describe("true: pagamento registrado; false: sem pagamento registrado. Omitir inclui ambos. Receita de pedidos não exige pagamento."),
};

export function validOrderPeriod(input: PeriodInput): boolean {
  if (input.period !== undefined && (input.from !== undefined || input.to !== undefined)) return false;
  if (input.period === "last_n_days" ? input.days === undefined : input.days !== undefined) return false;
  return input.from === undefined || input.to === undefined || input.from <= input.to;
}

export const orderPeriodValidation = {
  message: "Use period sem from/to; days apenas e obrigatoriamente com last_n_days. Em datas explícitas, from deve ser anterior ou igual a to.",
  path: ["to"],
};
