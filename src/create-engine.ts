import { createEngine } from "@invokta/core";

import type { BackendGateway } from "./application/ports.js";
import { createCashCapabilities } from "./capabilities/cash.js";
import { createClientCapabilities } from "./capabilities/clients.js";
import { createDashboardCapabilities } from "./capabilities/dashboard.js";
import { createInventoryCapabilities } from "./capabilities/inventory.js";
import { createOrderCapabilities } from "./capabilities/orders.js";
import { createProductCapabilities } from "./capabilities/products.js";
import { auditLogger, recordEngineEvent } from "./infrastructure/audit.js";

export function createDeuxOrdersEngine(backend: BackendGateway) {
  return createEngine({
    name: "deuxorders-mcp",
    version: "0.1.0",
    logger: auditLogger,
    onEvent: recordEngineEvent,
    capabilities: {
      ...createClientCapabilities(backend),
      ...createOrderCapabilities(backend),
      ...createProductCapabilities(backend),
      ...createInventoryCapabilities(backend),
      ...createCashCapabilities(backend),
      ...createDashboardCapabilities(backend),
    },
  });
}
