import vm from "node:vm";
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

function createConsoleSink() {
  const lines = [];
  const write = (level, args) => {
    const text = args.map((value) => {
      if (typeof value === "string") return value;
      if (value instanceof Error) return value.stack || value.message;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }).join(" ");
    lines.push(level ? `[${level}] ${text}` : text);
  };

  return {
    lines,
    console: {
      log: (...args) => write("", args),
      info: (...args) => write("info", args),
      warn: (...args) => write("warn", args),
      error: (...args) => write("error", args)
    }
  };
}

function sanitizeFilename(value) {
  return String(value || "snippet")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "snippet";
}

function formatResult(value) {
  if (value == null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function readSnippetFromRl(rl, { intro = "Paste JavaScript. End with a line containing only EOF.", terminator = "EOF" } = {}) {
  console.log(intro);
  const lines = [];
  while (true) {
    const line = await rl.question(lines.length ? "... " : "js> ");
    if (String(line).trim() === terminator) {
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export async function runSolanaSnippet(ctx, code, { timeoutMs = 15000, label = "solana-snippet" } = {}) {
  const { lines, console } = createConsoleSink();
  const sandbox = {
    console,
    solana: ctx.solana,
    session: ctx.session.operatorContext(),
    workspace: ctx.session.state.workspace,
    rpcUrl: ctx.session.state.rpcUrl,
    network: ctx.session.state.network,
    wallet: ctx.session.state.currentWallet || null,
    PublicKey,
    Connection,
    clusterApiUrl,
    Keypair,
    LAMPORTS_PER_SOL,
    fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Buffer,
    JSON,
    Math,
    Date
  };

  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.require = undefined;
  sandbox.process = undefined;
  sandbox.module = undefined;
  sandbox.exports = undefined;

  const context = vm.createContext(sandbox, {
    name: "orion-solana-snippet",
    codeGeneration: { strings: true, wasm: false }
  });

  const source = `"use strict";
(async () => {
${code}
})()`;
  const startedAt = Date.now();
  const filename = `${sanitizeFilename(label)}.mjs`;
  let execution;
  try {
    execution = vm.runInContext(source, context, {
      filename,
      displayErrors: true
    });
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      stdout: lines,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Snippet timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  let result;
  try {
    result = await Promise.race([Promise.resolve(execution), timeout]);
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      stdout: lines,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return {
    ok: true,
    elapsedMs: Date.now() - startedAt,
    stdout: lines,
    result: formatResult(result)
  };
}
