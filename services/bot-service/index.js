import express from "express";
import { Bot, InputFile } from "grammy";
import { config, requireConfig } from "../shared/config.js";

const app = express();
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function parseStrategyArg(ctx) {
  const text = ctx.msg?.text || "";
  return text.split(" ").slice(1).join(" ").trim().toLowerCase();
}

async function agentRequest(path, options = {}) {
  const response = await fetch(`${config.agentServiceUrl}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Agent service request failed: ${response.status}`);
  }
  return payload;
}

async function fetchAudioFromAgent(audioUrl) {
  const audioResponse = await fetch(`${config.agentServiceUrl}${audioUrl}`);
  if (!audioResponse.ok) {
    throw new Error("Failed to retrieve generated audio");
  }

  return Buffer.from(await audioResponse.arrayBuffer());
}

function formatStatus(status) {
  const lastDecision = status.lastDecision
    ? `Last decision: ${status.lastDecision.decision.action} ${status.lastDecision.decision.amount} SOL at confidence ${status.lastDecision.decision.confidence.toFixed(2)}`
    : "Last decision: none yet";

  return [
    `Wallet: ${status.wallet?.publicKey || "not created"}`,
    `Strategy: ${status.strategy}`,
    `Autonomy: ${status.active ? "active" : "inactive"}${status.paused ? " (paused)" : ""}`,
    `Balance: ${status.portfolio ? `${status.portfolio.solBalance.toFixed(4)} SOL` : "n/a"}`,
    lastDecision
  ].join("\n");
}

requireConfig(config.telegramBotToken, "TELEGRAM_BOT_TOKEN");
const bot = new Bot(config.telegramBotToken);

bot.command("start", async (ctx) => {
  await ctx.reply(
    [
      "ORION AI is online.",
      "Commands:",
      "/create_wallet",
      "/set_strategy conservative|balanced|aggressive",
      "/activate",
      "/status",
      "/history",
      "/pause",
      "/resume",
      "/call_me"
    ].join("\n")
  );
});

bot.command("create_wallet", async (ctx) => {
  try {
    const wallet = await agentRequest(`/users/${ctx.from.id}/wallet`, {
      method: "POST"
    });
    await ctx.reply(`Wallet ready: ${wallet.publicKey}`);
  } catch (error) {
    await ctx.reply(`Wallet error: ${error.message}`);
  }
});

bot.command("set_strategy", async (ctx) => {
  try {
    const strategy = parseStrategyArg(ctx);
    const result = await agentRequest(`/users/${ctx.from.id}/strategy`, {
      method: "POST",
      body: JSON.stringify({ strategy })
    });
    await ctx.reply(
      `Strategy updated to ${result.strategy}. Allocation ${Math.round(
        result.config.allocationPct * 100
      )}% | Risk ${result.config.riskTolerance} | Sensitivity ${result.config.executionSensitivity}`
    );
  } catch (error) {
    await ctx.reply(`Strategy error: ${error.message}`);
  }
});

bot.command("activate", async (ctx) => {
  try {
    await agentRequest(`/users/${ctx.from.id}/activate`, {
      method: "POST"
    });
    await ctx.reply("Autonomous agent activated. The worker loop will evaluate your portfolio every 60 seconds.");
  } catch (error) {
    await ctx.reply(`Activate error: ${error.message}`);
  }
});

bot.command("status", async (ctx) => {
  try {
    const status = await agentRequest(`/users/${ctx.from.id}/status`);
    await ctx.reply(formatStatus(status));
  } catch (error) {
    await ctx.reply(`Status error: ${error.message}`);
  }
});

bot.command("history", async (ctx) => {
  try {
    const result = await agentRequest(`/users/${ctx.from.id}/history?limit=5`);
    if (!result.history.length) {
      await ctx.reply("No audit history yet.");
      return;
    }

    const lines = result.history.map((row) => {
      const timestamp = row.EVENT_TIME || row.event_time || "unknown-time";
      const action = row.ACTION || row.action || "hold";
      const status = row.STATUS || row.status || "unknown";
      const confidence = row.CONFIDENCE ?? row.confidence ?? "n/a";
      return `${timestamp} | ${action} | ${status} | confidence ${confidence}`;
    });

    await ctx.reply(lines.join("\n"));
  } catch (error) {
    await ctx.reply(`History error: ${error.message}`);
  }
});

bot.command("pause", async (ctx) => {
  try {
    await agentRequest(`/users/${ctx.from.id}/pause`, {
      method: "POST"
    });
    await ctx.reply("Autonomous agent paused.");
  } catch (error) {
    await ctx.reply(`Pause error: ${error.message}`);
  }
});

bot.command("resume", async (ctx) => {
  try {
    await agentRequest(`/users/${ctx.from.id}/resume`, {
      method: "POST"
    });
    await ctx.reply("Autonomous agent resumed.");
  } catch (error) {
    await ctx.reply(`Resume error: ${error.message}`);
  }
});

bot.command("call_me", async (ctx) => {
  try {
    try {
      const loading = await agentRequest(`/users/${ctx.from.id}/loading-audio`, {
        method: "POST"
      });
      const loadingBuffer = await fetchAudioFromAgent(loading.audioUrl);
      await ctx.reply("Preparing your Orion call.");
      await ctx.replyWithAudio(new InputFile(loadingBuffer, loading.fileName), {
        title: "Orion loading audio"
      });
    } catch (loadingError) {
      await ctx.reply(`Preparing your Orion call. Loading audio unavailable: ${loadingError.message}`);
    }

    const result = await agentRequest(`/users/${ctx.from.id}/call-me`, {
      method: "POST"
    });

    const audioBuffer = await fetchAudioFromAgent(result.audioUrl);
    await ctx.reply(result.text);
    await ctx.replyWithAudio(new InputFile(audioBuffer, result.fileName), {
      title: "Orion portfolio call"
    });
  } catch (error) {
    await ctx.reply(`Voice error: ${error.message}`);
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.msg.text.trim();
  if (!text || text.startsWith("/")) {
    return;
  }

  try {
    const result = await agentRequest(`/users/${ctx.from.id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: text })
    });
    await ctx.reply(result.response);
  } catch (error) {
    await ctx.reply(`Agent error: ${error.message}`);
  }
});

bot.start();

app.listen(config.botPort, () => {
  console.log(`bot-service listening on port ${config.botPort}`);
});
