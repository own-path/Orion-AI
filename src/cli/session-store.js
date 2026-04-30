import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../../services/shared/config.js";
import { estimateTokens } from "./ui.js";

const defaultState = {
  sessionId: randomUUID(),
  onboardingDone: false,
  currentWallet: null,
  currentStrategy: "balanced",
  langs: ["en", "fr"],
  rpcUrl: config.solanaRpcUrl,
  network: config.solanaNetwork,
  model: config.ollamaModel,
  workspace: process.cwd(),
  history: [],
  tokenCount: 0,
  tokenOverhead: 0,
  memory: {
    solana: {
      recentLookups: [],
      lastAddress: null,
      lastTransactionBatch: null
    }
  }
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
    if (!merged.memory || typeof merged.memory !== "object") {
      merged.memory = JSON.parse(JSON.stringify(defaultState.memory));
    }
    if (!merged.memory.solana || typeof merged.memory.solana !== "object") {
      merged.memory.solana = JSON.parse(JSON.stringify(defaultState.memory.solana));
    }
    if (!Array.isArray(merged.memory.solana.recentLookups)) {
      merged.memory.solana.recentLookups = [];
    }
    // Solana memory and conversation history are session-scoped — don't carry across restarts.
    merged.memory.solana = JSON.parse(JSON.stringify(defaultState.memory.solana));
    merged.history = [];
    merged.tokenCount = 0;
    merged.tokenOverhead = 0;
    if (!merged.sessionId) {
      merged.sessionId = randomUUID();
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
