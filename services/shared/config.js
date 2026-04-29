import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const dataDir = process.env.ORION_DATA_DIR || path.resolve(process.cwd(), "data");

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  botPort: Number(process.env.BOT_PORT || 3000),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  agentServiceUrl: process.env.AGENT_SERVICE_URL || "http://localhost:8080",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  geminiRequired: process.env.GEMINI_REQUIRED !== "false",
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 30000),
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  solanaNetwork: process.env.SOLANA_NETWORK || "devnet",
  solanaExecutionMode: process.env.SOLANA_EXECUTION_MODE || "mock",
  decisionThreshold: Number(process.env.ORION_DECISION_CONFIDENCE_THRESHOLD || 0.6),
  loopIntervalMs: Number(process.env.ORION_LOOP_INTERVAL_MS || 60000),
  dataDir,
  stateFilePath: path.join(dataDir, "runtime-state.json"),
  voiceDir: path.join(dataDir, "voice"),
  snowflakeRequired: process.env.SNOWFLAKE_REQUIRED !== "false",
  snowflake: {
    account: process.env.SNOWFLAKE_ACCOUNT || "",
    username: process.env.SNOWFLAKE_USERNAME || "",
    password: process.env.SNOWFLAKE_PASSWORD || "",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "",
    database: process.env.SNOWFLAKE_DATABASE || "",
    schema: process.env.SNOWFLAKE_SCHEMA || "",
    role: process.env.SNOWFLAKE_ROLE || ""
  },
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
