import { CliSessionStore } from "./session-store.js";
import { estimateTokens } from "./ui.js";

export class HarnessSession {
  constructor(store, state) {
    this.store = store;
    this.state = state;
  }

  static async load() {
    const store = new CliSessionStore();
    const state = await store.load();
    return new HarnessSession(store, state);
  }

  operatorContext() {
    return {
      wallet: this.state.currentWallet,
      strategy: this.state.currentStrategy,
      rpcUrl: this.state.rpcUrl,
      workspace: this.state.workspace,
      network: this.state.network,
      model: this.state.model
    };
  }

  appendHistory(role, content) {
    this.state.history = [...this.state.history.slice(-49), { role, content, at: new Date().toISOString() }];
    this.syncTokenCount();
  }

  recordTokenUsage(...parts) {
    const text = parts.flat().filter(Boolean).map((part) => String(part)).join(" ");
    if (!text) {
      return;
    }
    const overhead = estimateTokens([{ content: text }]);
    if (!Number.isFinite(Number(this.state.tokenOverhead))) {
      this.state.tokenOverhead = 0;
    }
    this.state.tokenOverhead = Math.max(this.state.tokenOverhead, overhead);
    this.syncTokenCount();
  }

  syncTokenCount() {
    const historyTokens = estimateTokens(this.state.history || []);
    const overhead = Number.isFinite(Number(this.state.tokenOverhead)) ? Number(this.state.tokenOverhead) : 0;
    this.state.tokenCount = historyTokens + overhead;
  }

  clearHistory() {
    this.state.history = [];
    this.syncTokenCount();
  }

  getMemory() {
    if (!this.state.memory || typeof this.state.memory !== "object") {
      this.state.memory = {};
    }
    if (!this.state.memory.solana || typeof this.state.memory.solana !== "object") {
      this.state.memory.solana = {
        recentLookups: [],
        lastAddress: null,
        lastTransactionBatch: null
      };
    }
    if (!Array.isArray(this.state.memory.solana.recentLookups)) {
      this.state.memory.solana.recentLookups = [];
    }
    return this.state.memory;
  }

  rememberSolanaLookup(entry) {
    const memory = this.getMemory();
    const solana = memory.solana;
    solana.lastAddress = entry.address || solana.lastAddress || null;
    solana.recentLookups = [
      {
        at: new Date().toISOString(),
        ...entry
      },
      ...solana.recentLookups.filter((item) => item && item.address !== entry.address)
    ].slice(0, 10);
  }

  rememberTransactionBatch(entry) {
    const memory = this.getMemory();
    memory.solana.lastTransactionBatch = {
      at: new Date().toISOString(),
      ...entry
    };
    if (entry.address) {
      memory.solana.lastAddress = entry.address;
    }
  }

  async save() {
    await this.store.save(this.state);
  }

  async setModel(model) {
    this.state.model = model;
    await this.save();
  }

  async setWallet(address) {
    this.state.currentWallet = address;
    await this.save();
  }

  async setGeneratedWallet(wallet) {
    this.state.currentWallet = wallet.publicKey;
    this.state.generatedWallet = wallet;
    await this.save();
  }

  async setStrategy(strategy) {
    this.state.currentStrategy = strategy;
    await this.save();
  }

  async setRpc({ rpcUrl, network }) {
    this.state.rpcUrl = rpcUrl;
    this.state.network = network;
    await this.save();
  }

  async completeOnboarding() {
    this.state.onboardingDone = true;
    await this.save();
  }
}
