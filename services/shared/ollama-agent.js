import { config } from "./config.js";

function readMessageText(payload) {
  const content = payload?.message?.content?.trim();
  if (!content) {
    throw new Error("Ollama returned no message content");
  }
  return content;
}

function safeParseJson(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    return fallback(content);
  }
}

function decisionFallback(content) {
  return {
    action: "hold",
    amount: 0,
    reason: `Could not parse decision JSON from Ollama output: ${content.slice(0, 200)}`,
    confidence: 0
  };
}

async function postJson(baseUrl, pathname, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || `Ollama request failed: ${response.status}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export class OllamaAgentClient {
  constructor() {
    this.refreshConfig();
  }

  refreshConfig() {
    this.baseUrl = config.ollamaBaseUrl;
    this.model = config.ollamaModel;
    this.apiKey = config.ollamaApiKey;
    this.required = config.ollamaRequired;
    this.timeoutMs = config.ollamaTimeoutMs;
    return this;
  }

  ensureConfigured() {
    this.refreshConfig();
    if (!this.required) {
      return false;
    }

    if (!this.baseUrl || !this.model) {
      throw new Error("Ollama configuration is incomplete");
    }

    return true;
  }

  async checkHealth() {
    this.refreshConfig();
    const isRemote = /^https?:\/\/(?!(127\.0\.0\.1|localhost))/i.test(this.baseUrl);
    const headers = this.apiKey
      ? { Authorization: `Bearer ${this.apiKey}` }
      : undefined;
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { headers });
      if (response.status === 401 || response.status === 403) {
        return { available: false, models: [], remote: isRemote, authFailed: true };
      }
      if (!response.ok) {
        return { available: false, models: [], remote: isRemote };
      }
      const payload = await response.json().catch(() => ({}));
      return {
        available: true,
        remote: isRemote,
        models: (payload.models || []).map((model) => model.name)
      };
    } catch {
      return { available: false, models: [], remote: isRemote };
    }
  }

  async listModels() {
    const health = await this.checkHealth();
    return health.models;
  }

  async chat({ system, prompt, format, model = config.ollamaModel }) {
    this.refreshConfig();
    this.ensureConfigured();
    const payload = await postJson(this.baseUrl, "/api/chat", {
      model: model || this.model,
      stream: false,
      format,
      messages: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    return readMessageText(payload);
  }

  async getDecision(input, options = {}) {
    this.refreshConfig();
    if (!this.ensureConfigured()) {
      return {
        action: "hold",
        amount: 0,
        reason: "Ollama is unavailable, defaulting to hold.",
        confidence: 0
      };
    }

    const content = await this.chat({
      system:
        "You are ORION AI, a Solana DeFi copilot. Return only valid JSON with exactly these fields: action, amount, reason, confidence. action must be one of stake, swap, hold. confidence must be a number from 0 to 1. Never suggest an amount above portfolio.maxAllocatableSol.",
      prompt: JSON.stringify(input),
      format: "json",
      model: options.model || this.model
    });

    const parsed = safeParseJson(content, decisionFallback);
    return {
      action: parsed.action || "hold",
      amount: Number(parsed.amount || 0),
      reason: String(parsed.reason || ""),
      confidence: Number(parsed.confidence || 0)
    };
  }

  async askOperator(input, options = {}) {
    this.refreshConfig();
    if (!this.ensureConfigured()) {
      return "Ollama is unavailable right now.";
    }

    return this.chat({
      system:
        "You are ORION, a terminal-based Solana operator assistant. Be concise, practical, and command-aware. Prioritize wallet inspection, RPC awareness, transaction explanation, and repository-oriented reasoning. Do not claim actions were executed unless the context explicitly says so.",
      prompt: JSON.stringify(input),
      model: options.model || this.model
    });
  }

  async rewriteFile({ filePath, currentContent, instruction, workspaceContext, model }) {
    this.refreshConfig();
    if (!this.ensureConfigured()) {
      throw new Error("Ollama is unavailable right now.");
    }

    const content = await this.chat({
      system:
        "You are preparing a file rewrite for a terminal coding assistant. Return only valid JSON with keys summary and content. content must be the complete new file contents. Preserve behavior not mentioned in the instruction.",
      prompt: JSON.stringify({
        filePath,
        instruction,
        workspaceContext,
        currentContent
      }),
      format: "json",
      model: model || this.model
    });

    return safeParseJson(content, (raw) => ({
      summary: "Unstructured rewrite response",
      content: raw
    }));
  }
}
