import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../services/shared/config.js";

const defaultState = {
  onboardingDone: false,
  currentWallet: null,
  currentStrategy: "balanced",
  langs: ["en", "fr"],
  rpcUrl: config.solanaRpcUrl,
  network: config.solanaNetwork,
  model: config.ollamaModel,
  workspace: process.cwd(),
  history: []
};

export class CliSessionStore {
  constructor(filePath = config.cliSessionFilePath) {
    this.filePath = filePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(defaultState, null, 2), "utf8");
    }
  }

  async load() {
    await this.init();
    const raw = await fs.readFile(this.filePath, "utf8");
    const merged = {
      ...defaultState,
      ...JSON.parse(raw)
    };
    if (!Array.isArray(merged.langs) || merged.langs.length === 0) {
      merged.langs = defaultState.langs;
    }
    // Migrate stale local-only model names to the configured default.
    if (merged.model === "llama3.1:8b" || merged.model === "gemma4" || merged.model === "gemma3") {
      merged.model = config.ollamaModel;
    }
    return merged;
  }

  async save(nextState) {
    await this.init();
    await fs.writeFile(this.filePath, JSON.stringify(nextState, null, 2), "utf8");
  }
}
