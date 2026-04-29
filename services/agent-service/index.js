import express from "express";
import fs from "node:fs";
import { config } from "../shared/config.js";
import { RuntimeStateStore } from "../shared/file-store.js";
import { GeminiAgentClient } from "../shared/gemini-agent.js";
import { getStrategyConfig, normalizeStrategy } from "../shared/strategies.js";
import { SolanaService } from "../solana-service/index.js";
import { SnowflakeAuditService } from "../snowflake-service/index.js";
import { VoiceService } from "../voice-service/index.js";

const app = express();
app.use(express.json());

const stateStore = new RuntimeStateStore();
const solanaService = new SolanaService();
const auditService = new SnowflakeAuditService();
const voiceService = new VoiceService();
const geminiClient = new GeminiAgentClient();

await stateStore.init();
await voiceService.init();
await auditService.ensureAuditTable();

if (!fs.existsSync(config.voiceDir)) {
  fs.mkdirSync(config.voiceDir, { recursive: true });
}

app.use("/audio", express.static(config.voiceDir));

function buildMarketContext({ portfolio, strategy }) {
  const strategyConfig = getStrategyConfig(strategy);
  const concentration = portfolio.solBalance === 0 ? 0 : portfolio.maxAllocatableSol / portfolio.solBalance;
  return {
    marketRegime: concentration > 0.25 ? "risk-on" : "cautious",
    riskTolerance: strategyConfig.riskTolerance,
    executionSensitivity: strategyConfig.executionSensitivity,
    notes: [
      "Simplified market context for hackathon MVP.",
      `Reference SOL price set to ${portfolio.estimatedUsdValue && portfolio.solBalance ? (portfolio.estimatedUsdValue / portfolio.solBalance).toFixed(2) : "150.00"} USD`
    ]
  };
}

function clampDecisionAmount(decision, portfolio) {
  return {
    ...decision,
    amount: Number(Math.max(0, Math.min(decision.amount, portfolio.maxAllocatableSol)).toFixed(4))
  };
}

async function logEvent(event) {
  await auditService.logAuditEvent({
    timestamp: new Date().toISOString(),
    ...event
  });
}

async function processUser(user) {
  const portfolio = await solanaService.getPortfolioState(user.wallet.publicKey, user.strategy);
  const marketContext = buildMarketContext({ portfolio, strategy: user.strategy });
  let decision = await geminiClient.getDecision({
    userId: user.userId,
    strategy: user.strategy,
    portfolio,
    marketContext,
    lastDecision: user.lastDecision
  });
  decision = clampDecisionAmount(decision, portfolio);

  let status = "held";
  let txSignature = null;
  let voiceArtifact = null;

  try {
    if (decision.confidence > config.decisionThreshold && decision.action !== "hold") {
      const execution = await solanaService.executeAutonomousAction({ user, decision });
      status = execution.status;
      txSignature = execution.signature;

      const confirmationText = `Orion executed a ${decision.action} decision for ${decision.amount} SOL. Reason: ${decision.reason}`;
      try {
        voiceArtifact = await voiceService.generateSpeechToFile({
          text: confirmationText,
          filePrefix: `trade-${user.userId}`
        });
      } catch (voiceError) {
        voiceArtifact = { error: voiceError.message };
      }
    } else if (decision.confidence <= config.decisionThreshold) {
      status = "skipped_low_confidence";
    }
  } catch (error) {
    status = "execution_failed";
    decision.reason = `${decision.reason} Execution error: ${error.message}`;
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    decision,
    status,
    txSignature,
    portfolio,
    marketContext,
    voiceArtifact
  };

  await stateStore.upsertUser(user.userId, (current) => ({
    ...current,
    lastDecision: snapshot
  }));

  await logEvent({
    userId: user.userId,
    eventType: "agent_decision",
    action: decision.action,
    reason: decision.reason,
    confidence: decision.confidence,
    status,
    strategy: user.strategy,
    txSignature,
    metadata: {
      amount: decision.amount,
      portfolio,
      marketContext,
      voiceArtifact
    }
  });

  return snapshot;
}

async function buildUserChatContext(userId) {
  const user = await stateStore.getUser(userId);
  if (!user) {
    return {
      user: null,
      portfolio: null
    };
  }

  const portfolio = user.wallet
    ? await solanaService.getPortfolioState(user.wallet.publicKey, user.strategy)
    : null;

  return { user, portfolio };
}

let loopInFlight = false;

async function runAgentLoop() {
  if (loopInFlight) {
    return;
  }
  loopInFlight = true;
  try {
    const users = await stateStore.listActiveUsers();
    for (const user of users) {
      await processUser(user);
    }
  } catch (error) {
    console.error("agent-loop-error", error);
  } finally {
    loopInFlight = false;
  }
}

app.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
    loopIntervalMs: config.loopIntervalMs
  });
});

app.post("/users/:userId/wallet", async (req, res) => {
  try {
    const existing = await stateStore.getUser(req.params.userId);
    if (existing?.wallet) {
      res.json({ publicKey: existing.wallet.publicKey });
      return;
    }

    const wallet = await solanaService.createWallet();
    await stateStore.upsertUser(req.params.userId, (current) => ({
      ...current,
      wallet
    }));

    await logEvent({
      userId: req.params.userId,
      eventType: "wallet_created",
      action: "hold",
      reason: "Wallet generated for user",
      confidence: 1,
      status: "success",
      metadata: {
        publicKey: wallet.publicKey
      }
    });

    res.status(201).json({ publicKey: wallet.publicKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/strategy", async (req, res) => {
  try {
    const strategy = normalizeStrategy(req.body.strategy);
    if (!strategy) {
      res.status(400).json({ error: "Strategy must be conservative, balanced, or aggressive" });
      return;
    }

    const user = await stateStore.upsertUser(req.params.userId, (current) => ({
      ...current,
      strategy
    }));

    await logEvent({
      userId: req.params.userId,
      eventType: "strategy_updated",
      action: "hold",
      reason: `Strategy set to ${strategy}`,
      confidence: 1,
      status: "success",
      strategy
    });

    res.json({
      strategy,
      config: getStrategyConfig(strategy),
      user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/activate", async (req, res) => {
  try {
    const user = await stateStore.upsertUser(req.params.userId, (current) => ({
      ...current,
      active: true,
      paused: false
    }));

    await logEvent({
      userId: req.params.userId,
      eventType: "agent_activated",
      action: "hold",
      reason: "Autonomous mode activated",
      confidence: 1,
      status: "success",
      strategy: user.strategy
    });

    res.json({ active: true, paused: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/pause", async (req, res) => {
  try {
    await stateStore.upsertUser(req.params.userId, (current) => ({
      ...current,
      paused: true
    }));

    await logEvent({
      userId: req.params.userId,
      eventType: "agent_paused",
      action: "hold",
      reason: "Autonomous mode paused",
      confidence: 1,
      status: "success"
    });

    res.json({ paused: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/resume", async (req, res) => {
  try {
    await stateStore.upsertUser(req.params.userId, (current) => ({
      ...current,
      active: true,
      paused: false
    }));

    await logEvent({
      userId: req.params.userId,
      eventType: "agent_resumed",
      action: "hold",
      reason: "Autonomous mode resumed",
      confidence: 1,
      status: "success"
    });

    res.json({ active: true, paused: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/users/:userId/status", async (req, res) => {
  try {
    const user = await stateStore.getUser(req.params.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const portfolio = user.wallet
      ? await solanaService.getPortfolioState(user.wallet.publicKey, user.strategy)
      : null;

    res.json({
      userId: user.userId,
      strategy: user.strategy,
      strategyConfig: getStrategyConfig(user.strategy),
      active: user.active,
      paused: user.paused,
      wallet: user.wallet ? { publicKey: user.wallet.publicKey } : null,
      portfolio,
      lastDecision: user.lastDecision
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/users/:userId/history", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 10);
    const rows = await auditService.getAuditHistory(req.params.userId, limit);
    res.json({ history: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/chat", async (req, res) => {
  try {
    const { user, portfolio } = await buildUserChatContext(req.params.userId);
    const message = String(req.body.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const chat = await geminiClient.chat({
      userId: req.params.userId,
      message,
      strategy: user?.strategy || "balanced",
      portfolio,
      autonomy: {
        active: user?.active || false,
        paused: user?.paused || false
      },
      lastDecision: user?.lastDecision || null
    });

    await logEvent({
      userId: req.params.userId,
      eventType: "agent_chat",
      action: "hold",
      reason: "Telegram user initiated agent conversation",
      confidence: 1,
      status: "success",
      strategy: user?.strategy || "balanced",
      metadata: {
        prompt: message,
        response: chat.response
      }
    });

    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/call-me", async (req, res) => {
  try {
    const user = await stateStore.getUser(req.params.userId);
    if (!user?.wallet) {
      res.status(404).json({ error: "User wallet not found" });
      return;
    }

    const portfolio = await solanaService.getPortfolioState(user.wallet.publicKey, user.strategy);
    const summary = `Orion portfolio update. Wallet ${user.wallet.publicKey}. Current balance ${portfolio.solBalance.toFixed(
      4
    )} SOL. Estimated value ${portfolio.estimatedUsdValue.toFixed(2)} dollars. Strategy ${user.strategy}.`;

    const audio = await voiceService.generateSpeechToFile({
      text: summary,
      filePrefix: `portfolio-${user.userId}`
    });

    await logEvent({
      userId: req.params.userId,
      eventType: "voice_summary",
      action: "hold",
      reason: "Portfolio voice summary generated",
      confidence: 1,
      status: "success",
      strategy: user.strategy,
      metadata: {
        audioUrl: audio.audioUrl
      }
    });

    res.json({
      text: summary,
      ...audio
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/loading-audio", async (req, res) => {
  try {
    const audio = await voiceService.ensureLoadingSoundEffect();

    await logEvent({
      userId: req.params.userId,
      eventType: "loading_audio",
      action: "hold",
      reason: "Loading audio generated or reused for Telegram call flow",
      confidence: 1,
      status: "success",
      metadata: {
        audioUrl: audio.audioUrl
      }
    });

    res.json(audio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/users/:userId/run-now", async (req, res) => {
  try {
    const user = await stateStore.getUser(req.params.userId);
    if (!user?.wallet) {
      res.status(404).json({ error: "User wallet not found" });
      return;
    }

    const result = await processUser(user);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(config.port, () => {
  console.log(`agent-service listening on port ${config.port}`);
  runAgentLoop().catch((error) => console.error("initial-loop-error", error));
  setInterval(() => {
    runAgentLoop().catch((error) => console.error("scheduled-loop-error", error));
  }, config.loopIntervalMs);
});
