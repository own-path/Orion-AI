import { CliSessionStore } from "./session-store.js";

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
    this.state.history = [...this.state.history.slice(-11), { role, content, at: new Date().toISOString() }];
  }

  clearHistory() {
    this.state.history = [];
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
