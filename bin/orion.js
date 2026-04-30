#!/usr/bin/env node

import { runCli } from "../src/cli/index.js";

runCli().catch((error) => {
  console.error(`orion fatal: ${error.message}`);
  process.exitCode = 1;
});
