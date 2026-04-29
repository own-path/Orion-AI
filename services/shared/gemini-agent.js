import { config } from "./config.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function extractText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no text content");
  }

  return text;
}

function safeParseDecision(content) {
  try {
    const parsed = JSON.parse(content);
    return {
      action: parsed.action || "hold",
      amount: Number(parsed.amount || 0),
      reason: String(parsed.reason || ""),
      confidence: Number(parsed.confidence || 0)
    };
  } catch {
    return {
      action: "hold",
      amount: 0,
      reason: `Could not parse decision JSON from Gemini output: ${content.slice(0, 200)}`,
      confidence: 0
    };
  }
}

function buildDecisionPrompt(input) {
  return {
    systemInstruction: {
      parts: [
        {
          text:
            "You are ORION AI, a Solana DeFi copilot. Return only valid JSON with exactly these fields: action, amount, reason, confidence. action must be one of stake, swap, hold. confidence must be a number from 0 to 1. Never suggest an amount above portfolio.maxAllocatableSol."
        }
      ]
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify(input)
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };
}

function buildChatPrompt(input) {
  return {
    systemInstruction: {
      parts: [
        {
          text:
            "You are ORION AI, an autonomous Solana DeFi copilot reachable from Telegram. Answer conversationally, clearly, and briefly. You may explain strategy, balances, and recent actions, but do not pretend to have executed anything unless the payload says so."
        }
      ]
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify(input)
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.4
    }
  };
}

export class GeminiAgentClient {
  async invoke(body) {
    if (!config.geminiApiKey) {
      if (config.geminiRequired) {
        throw new Error("Gemini configuration is incomplete");
      }
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.geminiTimeoutMs);

    try {
      const response = await fetch(`${GEMINI_API_BASE}/models/${config.geminiModel}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.geminiApiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || `Gemini request failed: ${response.status}`);
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDecision(input) {
    const result = await this.invoke(buildDecisionPrompt(input));
    if (!result) {
      return {
        action: "hold",
        amount: 0,
        reason: "Gemini is unavailable, defaulting to hold.",
        confidence: 0
      };
    }

    return safeParseDecision(extractText(result));
  }

  async chat(input) {
    const result = await this.invoke(buildChatPrompt(input));
    if (!result) {
      return { response: "The Gemini agent is unavailable right now." };
    }

    return {
      response: extractText(result)
    };
  }
}
