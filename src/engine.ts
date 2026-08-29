import { readBackendConfig } from "./config.js";
import { createDeuxOrdersEngine } from "./create-engine.js";
import { createBackendGateway } from "./infrastructure/backend-gateway.js";

export const engine = createDeuxOrdersEngine(createBackendGateway(readBackendConfig()));
