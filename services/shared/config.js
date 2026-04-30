import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { readEnvFile, writeEnvFile, mergeEnvEntries } from "./env-store.js";

dotenv.config();

const dataDir = process.env.ORION_DATA_DIR || path.join(os.homedir(), ".orion");
const persistentConfigFilePath = path.join(dataDir, "config.env");

function applyEnvEntries(entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (process.env[key] === undefined) {
      process.env[key] = String(value);
    }
  }
}

if (fs.existsSync(persistentConfigFilePath)) {
  const persisted = await readEnvFile(persistentConfigFilePath);
  applyEnvEntries(persisted);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "https://ollama.com",
  ollamaModel: process.env.OLLAMA_MODEL || "gemma4:31b-cloud",
  ollamaApiKey: process.env.OLLAMA_API_KEY || "",
  ollamaRequired: process.env.OLLAMA_REQUIRED !== "false",
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120000),
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  solanaNetwork: process.env.SOLANA_NETWORK || "devnet",
  solanaExecutionMode: process.env.SOLANA_EXECUTION_MODE || "mock",
  solscanBaseUrl: process.env.SOLSCAN_BASE_URL || "https://pro-api.solscan.io/v2.0",
  solscanApiKey: process.env.SOLSCAN_API_KEY || "",
  solscanRequired: process.env.SOLSCAN_REQUIRED === "true",
  decisionThreshold: Number(process.env.ORION_DECISION_CONFIDENCE_THRESHOLD || 0.6),
  loopIntervalMs: Number(process.env.ORION_LOOP_INTERVAL_MS || 60000),
  taskPollIntervalMs: Number(process.env.ORION_TASK_POLL_INTERVAL_MS || 5000),
  graphRecursionLimit: Number(process.env.ORION_GRAPH_RECURSION_LIMIT || 50),
  dataDir,
  cliSessionFilePath: path.join(dataDir, "cli-session.json"),
  cliTaskFilePath: path.join(dataDir, "tasks.json"),
  voiceDir: path.join(dataDir, "voice"),
  persistentConfigFilePath,
  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "",
    modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    loadingSfxText:
      process.env.ELEVENLABS_LOADING_SFX_TEXT || "Cinematic braam with suspenseful ambient loading tone",
    loadingSfxModelId: process.env.ELEVENLABS_LOADING_SFX_MODEL_ID || "eleven_text_to_sound_v2",
    loadingSfxDurationSeconds: Number(process.env.ELEVENLABS_LOADING_SFX_DURATION_SECONDS || 4)
  }
};

export async function persistConfig(patch) {
  const existing = fs.existsSync(persistentConfigFilePath)
    ? await readEnvFile(persistentConfigFilePath)
    : {};
  const merged = mergeEnvEntries(existing, patch);
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null) {
      process.env[key] = String(value);
    }
  }
  await writeEnvFile(persistentConfigFilePath, merged);
  syncConfigFromEnv();
}

export function syncConfigFromEnv() {
  const envOr = (name, fallback) => (process.env[name] !== undefined ? process.env[name] : fallback);
  config.nodeEnv = envOr("NODE_ENV", config.nodeEnv);
  config.ollamaBaseUrl = envOr("OLLAMA_BASE_URL", config.ollamaBaseUrl);
  config.ollamaModel = envOr("OLLAMA_MODEL", config.ollamaModel);
  config.ollamaApiKey = envOr("OLLAMA_API_KEY", config.ollamaApiKey);
  config.ollamaRequired = process.env.OLLAMA_REQUIRED !== undefined
    ? process.env.OLLAMA_REQUIRED !== "false"
    : config.ollamaRequired;
  config.ollamaTimeoutMs = Number(envOr("OLLAMA_TIMEOUT_MS", config.ollamaTimeoutMs));
  config.solanaRpcUrl = envOr("SOLANA_RPC_URL", config.solanaRpcUrl);
  config.solanaNetwork = envOr("SOLANA_NETWORK", config.solanaNetwork);
  config.solanaExecutionMode = envOr("SOLANA_EXECUTION_MODE", config.solanaExecutionMode);
  config.solscanBaseUrl = envOr("SOLSCAN_BASE_URL", config.solscanBaseUrl);
  config.solscanApiKey = envOr("SOLSCAN_API_KEY", config.solscanApiKey);
  config.solscanRequired = process.env.SOLSCAN_REQUIRED !== undefined
    ? process.env.SOLSCAN_REQUIRED === "true"
    : config.solscanRequired;
}

export function requireConfig(value, name) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}
