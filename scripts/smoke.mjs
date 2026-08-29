#!/usr/bin/env node
/**
 * Read-only sweep against the real DeuxOrders backend.
 *
 * Every capability contract in this repo was derived from the backend source,
 * not from observed responses. This script closes that gap: it invokes every
 * read capability against the live system and reports any whose output schema
 * does not match what the backend actually returns.
 *
 * It never writes. Run it before a release and after any backend change.
 */
import { engine } from "../dist/engine.js";

const principal = { id: "smoke:release-check" };
const results = [];

async function check(capabilityId, input, pick) {
  const started = Date.now();
  try {
    const output = await engine.invoke(capabilityId, input, { principal });
    results.push({
      capabilityId,
      status: "ok",
      ms: Date.now() - started,
      note: pick === undefined ? "" : pick(output),
    });
    return output;
  } catch (error) {
    results.push({
      capabilityId,
      status: error?.code === "OUTPUT_INVALID" ? "SCHEMA MISMATCH" : "failed",
      ms: Date.now() - started,
      note: `${error?.code ?? "ERROR"}: ${error?.message ?? String(error)}`,
    });
    return null;
  }
}

function count(page) {
  return page === null ? "" : `${page.items.length}/${page.totalCount}`;
}

const today = new Date();
const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
const iso = (date) => date.toISOString();
const month = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;

const clients = await check("clients.search", { page: 1, size: 3 }, count);
const orders = await check("orders.search", { page: 1, size: 3 }, count);
const products = await check("products.search", { page: 1, size: 3 }, count);
const materials = await check("inventory.search", { page: 1, size: 3 }, count);

await check("clients.list-options", {}, (out) => `${out.clients.length}`);
await check("products.list-options", {}, (out) => `${out.products.length}`);
await check("inventory.list-options", {}, (out) => `${out.materials.length}`);
await check("crm.list", { page: 1, size: 3 }, count);

await check("cash.search", { page: 1, size: 3 }, count);
await check("cash.summary", { from: iso(monthAgo), to: iso(today) }, (out) =>
  `saldo ${out.netBalanceCents}`,
);

await check("dashboard.summary", { createdAtFrom: iso(monthAgo), createdAtTo: iso(today) }, (out) =>
  `${out.totalOrders} pedidos`,
);
await check(
  "dashboard.revenue-over-time",
  { createdAtFrom: iso(monthAgo), createdAtTo: iso(today) },
  (out) => `${out.dataPoints.length} dias`,
);
await check(
  "dashboard.top-products",
  { createdAtFrom: iso(monthAgo), createdAtTo: iso(today), limit: 5 },
  (out) => `${out.products.length}`,
);
await check(
  "dashboard.top-clients",
  { createdAtFrom: iso(monthAgo), createdAtTo: iso(today), limit: 5 },
  (out) => `${out.clients.length}`,
);
await check("dashboard.export-orders", { from: iso(monthAgo), to: iso(today), format: "csv" }, (out) =>
  `${out.fileName} ${Math.round((out.base64.length * 3) / 4 / 1024)} KB`,
);

const clientId = clients?.items[0]?.id;
if (clientId !== undefined) {
  await check("clients.get", { clientId, includeOrders: true, size: 2 }, (out) => out.name);
  await check("clients.stats", { clientId }, (out) => `${out.totalOrders} pedidos`);
  await check("clients.list-orders", { clientId, page: 1, size: 2 }, count);
}

const orderId = orders?.items[0]?.id;
if (orderId !== undefined) {
  await check("orders.get", { orderId }, (out) => `${out.status} ${out.items.length} itens`);
}

const productId = products?.items[0]?.id;
if (productId !== undefined) {
  await check("products.get", { productId }, (out) => out.name);
  await check("products.stats", { productId, month }, (out) => `${out.soldThisMonth} vendidos`);
  await check("products.get-recipe", { productId }, (out) => `${out.items.length} materiais`);
  await check("products.list-recipe-options", { productId }, (out) => `${out.options.length} opções`);
  await check("products.list-order-options", { productId }, (out) => `${out.cakeDoughs.length} massas`);
}

const materialId = materials?.items[0]?.id;
if (materialId !== undefined) {
  await check("inventory.get", { materialId }, (out) => `${out.quantity} ${out.measureUnit}`);
}

const width = Math.max(...results.map((row) => row.capabilityId.length));
for (const row of results) {
  const mark = row.status === "ok" ? "ok  " : "FAIL";
  process.stdout.write(
    `${mark} ${row.capabilityId.padEnd(width)}  ${String(row.ms).padStart(5)}ms  ${row.note}\n`,
  );
}

const failed = results.filter((row) => row.status !== "ok");
const mismatched = results.filter((row) => row.status === "SCHEMA MISMATCH");
process.stdout.write(
  `\n${results.length - failed.length}/${results.length} capabilities ok` +
    (mismatched.length > 0 ? `, ${mismatched.length} com schema divergente` : "") +
    "\n",
);

const skipped = [clientId, orderId, productId, materialId].filter((id) => id === undefined).length;
if (skipped > 0) {
  process.stdout.write(`${skipped} grupo(s) pulado(s): a listagem correspondente veio vazia.\n`);
}

process.exitCode = failed.length === 0 ? 0 : 1;
