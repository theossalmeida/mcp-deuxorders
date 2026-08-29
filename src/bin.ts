#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { runEngineInstallerCli } from "@invokta/installer/engine";

process.exitCode = await runEngineInstallerCli({
  argv: process.argv.slice(2),
  binaryName: "deuxorders-mcp",
  packageRoot: fileURLToPath(new URL("..", import.meta.url)),
});
