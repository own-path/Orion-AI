import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const dataDir = process.env.ORION_DATA_DIR || path.join(os.homedir(), ".orion");

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
  dataDir,
  cliSessionFilePath: path.join(dataDir, "cli-session.json"),
  cliTaskFilePath: path.join(dataDir, "tasks.json"),
  voiceDir: path.join(dataDir, "voice"),
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

export function requireConfig(value, name) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value;
}
