import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../../services/shared/config.js";

const defaultState = {
  tasks: []
};

function now() {
  return new Date().toISOString();
}

export class TaskStore {
  constructor(filePath = config.cliTaskFilePath) {
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

  async loadState() {
    await this.init();
    const raw = await fs.readFile(this.filePath, "utf8");
    return {
      ...defaultState,
      ...JSON.parse(raw)
    };
  }

  async saveState(state) {
    await this.init();
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  async list() {
    const state = await this.loadState();
    return state.tasks || [];
  }

  async get(taskId) {
    const tasks = await this.list();
    return tasks.find((task) => task.id === taskId) || null;
  }

  async create(input) {
    const state = await this.loadState();
    const task = {
      id: randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      status: "queued",
      history: [],
      eventCount: 0,
      threadId: `orion-task-${Date.now()}`,
      ...input
    };
    state.tasks = [task, ...(state.tasks || [])].slice(0, 200);
    await this.saveState(state);
    return task;
  }

  async update(taskId, updater) {
    const state = await this.loadState();
    const index = (state.tasks || []).findIndex((task) => task.id === taskId);
    if (index === -1) {
      return null;
    }

    const current = state.tasks[index];
    const next = {
      ...current,
      ...(typeof updater === "function" ? updater(current) : updater),
      updatedAt: now()
    };
    state.tasks[index] = next;
    await this.saveState(state);
    return next;
  }

  async appendHistory(taskId, entry) {
    return this.update(taskId, (task) => ({
      history: [...(task.history || []).slice(-29), { at: now(), ...entry }]
    }));
  }
}
