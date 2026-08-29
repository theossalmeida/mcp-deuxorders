import "./env.js";

import { runCli } from "@invokta/cli";

import { engine } from "./engine.js";

process.exitCode = await runCli(engine, { principal: { id: "local:cli" } });
