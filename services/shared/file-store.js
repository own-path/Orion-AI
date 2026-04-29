import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const defaultState = {
  users: {}
};

export class RuntimeStateStore {
  constructor(filePath = config.stateFilePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(defaultState, null, 2), "utf8");
    }
  }

  async readState() {
    await this.init();
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async writeState(nextState) {
    await this.init();
    const tempPath = `${this.filePath}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(tempPath, JSON.stringify(nextState, null, 2), "utf8");
      await fs.rename(tempPath, this.filePath);
    });
    return this.writeQueue;
  }

  async getUser(userId) {
    const state = await this.readState();
    return state.users[String(userId)] || null;
  }

  async upsertUser(userId, updater) {
    const state = await this.readState();
    const id = String(userId);
    const previous = state.users[id] || {
      userId: id,
      strategy: "balanced",
      active: false,
      paused: false,
      wallet: null,
      lastDecision: null,
      updatedAt: null
    };
    const nextUser = {
      ...previous,
      ...updater(previous),
      updatedAt: new Date().toISOString()
    };
    state.users[id] = nextUser;
    await this.writeState(state);
    return nextUser;
  }

  async listActiveUsers() {
    const state = await this.readState();
    return Object.values(state.users).filter((user) => user.active && !user.paused && user.wallet);
  }
}
