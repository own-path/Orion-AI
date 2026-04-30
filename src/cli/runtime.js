import readline from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { PublicKey } from "@solana/web3.js";
import { config } from "../../services/shared/config.js";
import { OllamaAgentClient } from "../../services/shared/ollama-agent.js";
import { SolanaService } from "../../services/solana-service/index.js";
import { VoiceService } from "../../services/voice-service/index.js";
import { buildBootstrap } from "./bootstrap.js";
import { buildCommandRegistry } from "./command-registry.js";
import { LangGraphHarness } from "./langgraph-harness.js";
import { runOnboarding } from "./onboarding.js";
import { printAssistant, printError, printNotice, printPanel, printPlan, printStep, printStepDetail, printSummary, printUserEcho } from "./renderer.js";
import { HarnessSession } from "./runtime-session.js";
import { runShellCommand } from "./shell-tool.js";
import { TaskStore } from "./task-store.js";
import { muted, success } from "./theme.js";
import { buildToolRegistry } from "./tool-registry.js";
import { C, promptMarker, promptRule, rule, turnFooterHint, turnHeader, withSpinner } from "./ui.js";

function buildCompleter(commandRegistry) {
  return (line) => {
    if (!line.startsWith("/")) return [[], line];
    const prefix = line.toLowerCase();
    const hits = Array.from(commandRegistry.values())
      .filter((entry) => !entry.hidden)
      .map((entry) => `/${entry.name}`)
      .filter((name) => name.startsWith(prefix))
      .sort();
    return [hits, line];
  };
}

function parseCommand(line) {
  const trimmed = line.trim();
  const [name, ...rest] = trimmed.slice(1).split(" ");
  return {
    name: name.toLowerCase(),
    args: rest.filter(Boolean)
  };
}

function classifyLongHorizon(prompt) {
  const text = String(prompt).toLowerCase();
  const watchSignals = [
    "watch",
    "monitor",
    "keep an eye",
    "keep checking",
    "track",
    "observe",
    "follow",
    "alert me",
    "notify me",
    "revisit later",
    "come back later",
    "keep running",
    "long horizon"
  ];

  if (!watchSignals.some((phrase) => text.includes(phrase))) {
    const researchSignals = [
      "figure out",
      "find out",
      "investigate",
      "research",
      "analyze",
      "analyse",
      "compare",
      "scan",
      "look into",
      "dig into",
      "learn",
      "discover",
      "explore",
      "map out",
      "trace",
      "what happened",
      "what is going on",
      "what happened to",
      "explain what happened",
      "summarize what you found"
    ];

    if (researchSignals.some((phrase) => text.includes(phrase))) {
      return { kind: "task" };
    }

    return null;
  }

  const accountSignals = ["wallet", "account", "address", "pubkey", "public key"];
  const signatureSignals = ["signature", "tx", "transaction", "confirmed", "finalized"];
  const logsSignals = ["logs", "program", "events", "observability"];

  if (signatureSignals.some((phrase) => text.includes(phrase))) {
    return {
      kind: "watch",
      watchType: "signature"
    };
  }

  if (logsSignals.some((phrase) => text.includes(phrase))) {
    return {
      kind: "watch",
      watchType: "logs"
    };
  }

  if (accountSignals.some((phrase) => text.includes(phrase))) {
    return {
      kind: "watch",
      watchType: "account"
    };
  }

  return {
    kind: "task"
  };
}

function stripPromptForTarget(prompt) {
  return String(prompt)
    .replace(/^(watch|monitor|track|follow|keep an eye on|keep checking|observe)\s+/i, "")
    .trim();
}

function extractSolanaCandidate(text) {
  const matches = String(text).match(/\b[1-9A-HJ-NP-Za-km-z]{32,100}\b/g);
  return matches?.[0] || null;
}

function extractSolanaCandidates(text) {
  return [...new Set(String(text).match(/\b[1-9A-HJ-NP-Za-km-z]{32,100}\b/g) || [])];
}

function tokenizeText(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && ![
      "the",
      "and",
      "for",
      "with",
      "from",
      "that",
      "this",
      "are",
      "was",
      "were",
      "you",
      "your",
      "into",
      "about",
      "what",
      "who",
      "why",
      "how",
      "when",
      "where",
      "does",
      "doesnt",
      "dont",
      "not",
      "can",
      "will",
      "last",
      "recent",
      "each",
      "all"
    ].includes(token));
}

function overlapScore(promptTokens, text) {
  const itemTokens = new Set(tokenizeText(text));
  if (!promptTokens.size || !itemTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of promptTokens) {
    if (itemTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(promptTokens.size, 1);
}

function stringifyMemoryItem(item) {
  if (!item) return "";
  const parts = [
    item.address,
    item.sourceNetwork,
    item.prompt,
    item.query,
    item.lastAddress,
    ...(Array.isArray(item.recentSignatures) ? item.recentSignatures.map((entry) => entry.signature || entry) : []),
    ...(Array.isArray(item.transactions) ? item.transactions.flatMap((entry) => [
      entry.signature,
      entry.summary ? JSON.stringify(entry.summary) : "",
      entry.err ? JSON.stringify(entry.err) : ""
    ]) : []),
    item.lookupSnapshot ? JSON.stringify(item.lookupSnapshot) : "",
    item.explorerSnapshot ? JSON.stringify(item.explorerSnapshot) : ""
  ];
  return parts.filter(Boolean).join(" ");
}

function selectRelevantSolanaMemory(prompt, memory) {
  const solana = memory?.solana || {};
  const promptTokens = new Set(tokenizeText(prompt));
  const candidates = [];

  if (solana.lastTransactionBatch) {
    candidates.push({
      kind: "transaction-batch",
      item: solana.lastTransactionBatch
    });
  }

  if (Array.isArray(solana.recentLookups)) {
    for (const entry of solana.recentLookups.slice(0, 10)) {
      candidates.push({
        kind: entry.transactionBatch ? "transaction-batch" : "lookup",
        item: entry.transactionBatch || entry
      });
    }
  }

  let best = null;
  for (const [index, candidate] of candidates.entries()) {
    const text = stringifyMemoryItem(candidate.item);
    const score = overlapScore(promptTokens, text);
    const recency = Math.max(0, 1 - index * 0.08);
    const address = candidate.item?.address || candidate.item?.lastAddress || null;
    const exactAddressMatch = address && String(prompt).includes(String(address)) ? 1 : 0;
    const total = score * 0.7 + recency * 0.2 + exactAddressMatch * 0.1;

    if (!best || total > best.score) {
      best = {
        kind: candidate.kind,
        item: candidate.item,
        score: total
      };
    }
  }

  if (!best || best.score < 0.12) {
    return null;
  }

  return best;
}

function findCachedLookupForAddress(address, memory) {
  const solana = memory?.solana || {};
  const candidates = [];

  if (solana.lastTransactionBatch) {
    candidates.push(solana.lastTransactionBatch);
  }

  if (Array.isArray(solana.recentLookups)) {
    candidates.push(...solana.recentLookups);
  }

  const normalized = String(address || "");
  return candidates.find((entry) => {
    if (!entry) return false;
    return String(entry.address || entry.lastAddress || "").toLowerCase() === normalized.toLowerCase();
  }) || null;
}

function looksLikeSolanaEvidenceTask(text) {
  const lower = String(text).toLowerCase();
  return [
    "wallet",
    "account",
    "address",
    "pubkey",
    "public key",
    "signature",
    "transaction",
    "tx",
    "token account",
    "program",
    "balance",
    "portfolio",
    "fees",
    "activity",
    "fishy",
    "suspicious",
    "scam",
    "drain",
    "drained",
    "analysis"
  ].some((phrase) => lower.includes(phrase));
}

function formatSolAmount(balance) {
  if (!balance || typeof balance !== "object") {
    return null;
  }

  const value = Number(balance.solBalance);
  if (!Number.isFinite(value)) {
    return null;
  }

  return `${value.toFixed(9).replace(/\.?0+$/, "")} SOL`;
}

function isValidSolanaAddress(value) {
  if (!value) {
    return false;
  }
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function isLikelySolanaSignature(value) {
  return Boolean(value) && value.length >= 80 && value.length <= 100 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value) && !isValidSolanaAddress(value);
}


function promptWantsFreshLookup(prompt) {
  const text = String(prompt).toLowerCase();
  return [
    "fresh",
    "refresh",
    "latest",
    "up to date",
    "update me",
    "recheck",
    "re-check",
    "again"
  ].some((phrase) => text.includes(phrase));
}

function promptNeedsTransactionBatch(prompt) {
  const text = String(prompt).toLowerCase();
  return [
    "recent transactions",
    "last transactions",
    "transaction history",
    "history",
    "activity pattern",
    "activity patterns",
    "token flow",
    "token transfers",
    "inspect each transaction",
    "analyze each transaction",
    "analyze each of the",
    "review each transaction",
    "compare transactions",
    "fishy",
    "suspicious",
    "drain",
    "drained",
    "follow-up analysis"
  ].some((phrase) => text.includes(phrase));
}

function preferredTransactionBatchSize(prompt, fallback = 3) {
  const text = String(prompt).toLowerCase();
  const match = text.match(/\b(?:last|most recent|recent|latest)\s+(\d{1,2})\b/);
  const parsed = match ? Number(match[1]) : fallback;
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : fallback, 5));
}

function cachedBatchMeetsRequest(batch, prompt) {
  const required = preferredTransactionBatchSize(prompt, 3);
  const count = Array.isArray(batch?.transactions) ? batch.transactions.length : 0;
  return count >= required;
}

function selectSolanaCandidates(prompt, memory) {
  const promptCandidates = extractSolanaCandidates(prompt);
  const solana = memory?.solana || {};
  const memoryCandidates = [];

  if (solana.lastAddress) {
    memoryCandidates.push(solana.lastAddress);
  }

  if (solana.lastTransactionBatch?.address) {
    memoryCandidates.push(solana.lastTransactionBatch.address);
  }

  if (Array.isArray(solana.recentLookups)) {
    for (const entry of solana.recentLookups.slice(0, 3)) {
      if (entry?.address) {
        memoryCandidates.push(entry.address);
      }
      if (entry?.lastAddress) {
        memoryCandidates.push(entry.lastAddress);
      }
    }
  }

  return [...new Set([...promptCandidates, ...memoryCandidates].filter(Boolean))].slice(0, 2);
}


function isValidWatchTarget(watchType, target) {
  if (watchType === "logs") {
    return true;
  }
  return Boolean(extractSolanaCandidate(target));
}

function trimSummaryInput(input) {
  if (!input || typeof input !== "object") return input;
  const out = {
    target: input.target,
    kind: input.kind,
    sourceNetwork: input.sourceNetwork,
    prompt: input.prompt
  };
  if (input.balance) {
    const b = input.balance;
    out.balance = { solBalance: b.solBalance ?? b.lamports != null ? (b.lamports / 1e9) : null };
  }
  if (input.account) {
    out.account = { owner: input.account.owner, executable: input.account.executable };
  }
  if (Array.isArray(input.recentSignatures)) {
    out.recentSignatures = input.recentSignatures.slice(0, 5).map(s => ({
      signature: s.signature,
      confirmationStatus: s.confirmationStatus,
      err: s.err || null
    }));
  }
  if (Array.isArray(input.recentTransactions)) {
    out.recentTransactions = input.recentTransactions.slice(0, 5).map(t => ({
      signature: t.signature,
      err: t.err || null,
      summary: t.summary ? {
        type: t.summary.type,
        status: t.summary.status,
        fee: t.summary.fee,
        description: typeof t.summary.description === "string" ? t.summary.description.slice(0, 120) : undefined
      } : null
    }));
  }
  if (input.explorer) {
    const ex = input.explorer;
    out.explorer = {
      balance: ex.balance ?? ex.lamports,
      tokenAccounts: Array.isArray(ex.tokenAccounts) ? ex.tokenAccounts.length : undefined,
      defiPositions: Array.isArray(ex.defiPositions) ? ex.defiPositions.length : undefined
    };
  }
  if (input.transactionDetail || input.transactionActions) {
    const td = input.transactionDetail || input.transactionActions;
    out.transactionDetail = {
      status: td.status ?? td.txStatus,
      fee: td.fee ?? td.feeAmount,
      type: td.type ?? td.txType,
      err: td.err || td.parsedInstruction?.[0]?.type || null
    };
  }
  if (input.rpcTransaction) {
    const rt = input.rpcTransaction;
    out.rpcTransaction = { slot: rt.slot, err: rt.meta?.err || null, fee: rt.meta?.fee };
  }
  return out;
}

function renderOutcome(outcome) {
  if (!outcome) {
    return;
  }

  if (outcome.type === "panel") {
    printPanel(outcome.title, outcome.lines);
    return;
  }

  if (outcome.type === "patch") {
    console.log(`\n${outcome.patch || "No diff generated."}\n`);
    printSummary("Summary:", outcome.summary || "No summary.");
    console.log(outcome.applied ? success("Patch applied.") : muted("Patch preview discarded."));
    return;
  }

  if (outcome.type === "text") {
    console.log(outcome.text);
  }
}

function isAbortError(error) {
  return Boolean(error) && (
    error.name === "AbortError" ||
    error.code === "ABORT_ERR" ||
    /cancelled by esc/i.test(String(error.message || ""))
  );
}

export class OrionHarness {
  constructor({ rl, session, ollama, solana, voice, commandRegistry, toolRegistry, graphHarness, taskStore }) {
    this.rl = rl;
    this.session = session;
    this.ollama = ollama;
    this.solana = solana;
    this.voice = voice;
    this.commandRegistry = commandRegistry;
    this.toolRegistry = toolRegistry;
    this.graphHarness = graphHarness;
    this.taskStore = taskStore;
    this.watchDisposers = new Map();
    this.taskLoop = null;
    this.activeTaskId = null;
    this.currentPromptController = null;
    this.pendingQuestionController = null;
    this.onKeypress = null;
  }

  static async create() {
    const session = await HarnessSession.load();
    const ollama = new OllamaAgentClient();
    const solana = new SolanaService({
      rpcUrl: session.state.rpcUrl,
      network: session.state.network
    });
    const voice = new VoiceService();
    const toolRegistry = buildToolRegistry();
    const commandRegistry = buildCommandRegistry(toolRegistry);
    const rl = readline.createInterface({
      input,
      output,
      completer: buildCompleter(commandRegistry)
    });
    const taskStore = new TaskStore();
    const graphHarness = new LangGraphHarness({
      session,
      ollamaBaseUrl: ollama.baseUrl || undefined,
      model: session.state.model,
      toolRegistry,
      solana
    });

    const harness = new OrionHarness({
      rl,
      session,
      ollama,
      solana,
      voice,
      commandRegistry,
      toolRegistry,
      graphHarness,
      taskStore
    });

    await harness.resumeWatchTasks();
    harness.startTaskLoop();
    return harness;
  }

  context() {
    return {
      rl: this.rl,
      session: this.session,
      ollama: this.ollama,
      solana: this.solana,
      voice: this.voice,
      shell: runShellCommand,
      harness: this,
      commandRegistry: this.commandRegistry,
      toolRegistry: this.toolRegistry,
      taskStore: this.taskStore
    };
  }

  async boot() {
    return buildBootstrap({
      session: this.session,
      ollama: this.ollama,
      solana: this.solana,
      commandRegistry: this.commandRegistry,
      toolRegistry: this.toolRegistry,
      taskStore: this.taskStore
    });
  }

  async runOnboarding() {
    await runOnboarding(this.context());
    this.refreshRuntime();
  }

  refreshRuntime() {
    this.ollama.refreshConfig?.();
    this.graphHarness.ollamaBaseUrl = this.ollama.baseUrl || undefined;
    this.graphHarness.model = this.session.state.model || this.ollama.model || this.graphHarness.model;
  }

  async executeCommand(line) {
    const { name, args } = parseCommand(line);
    const entry = this.commandRegistry.get(name);
    if (!entry) {
      return { type: "text", text: "Unknown command. Type /help." };
    }

    const outcome = await entry.execute(this.context(), args);
    if (name === "cluster" || name === "rpc") {
      this.solana.setRpcUrl(this.session.state.rpcUrl, this.session.state.network);
    }
    return outcome;
  }

  async buildSolanaEvidence(text) {
    const memory = this.session.getMemory ? this.session.getMemory() : (this.session.state.memory || {});
    const relevantMemory = selectRelevantSolanaMemory(text, memory);
    const candidates = selectSolanaCandidates(text, memory);
    const needsTransactionBatch = Boolean(
      relevantMemory?.kind === "transaction-batch" ||
      promptNeedsTransactionBatch(text)
    );
    const batchLimit = preferredTransactionBatchSize(text, 3);
    const targets = [];

    if (relevantMemory?.kind === "transaction-batch" && relevantMemory.item && cachedBatchMeetsRequest(relevantMemory.item, text)) {
      targets.push({
        kind: "transaction-batch",
        target: relevantMemory.item.address || null,
        sourceNetwork: relevantMemory.item.sourceNetwork || this.session.state.network,
        cached: true,
        transactionBatch: relevantMemory.item
      });
    }

    for (const candidate of candidates.slice(0, 2)) {
      if (isValidSolanaAddress(candidate)) {
        const reuseCachedBatch = relevantMemory?.kind === "transaction-batch"
          && relevantMemory.item?.address === candidate;
        if (reuseCachedBatch) {
          targets.push({
            kind: "address",
            target: candidate,
            sourceNetwork: relevantMemory.item.sourceNetwork || this.session.state.network,
            lookupSnapshot: relevantMemory.item.lookupSnapshot || null,
            explorerSnapshot: relevantMemory.item.explorerSnapshot || null,
            transactionBatch: relevantMemory.item,
            cached: true
          });
          continue;
        }

        const cachedLookup = findCachedLookupForAddress(candidate, memory);
        const useCachedLookup = Boolean(
          cachedLookup &&
          !promptWantsFreshLookup(text) &&
          (
            cachedLookup.lookupSnapshot ||
            cachedLookup.balance ||
            cachedLookup.account ||
            cachedLookup.recentSignatures
          )
        );
        const lookupSnapshot = useCachedLookup
          ? cachedLookup.lookupSnapshot || {
              address: candidate,
              sourceNetwork: cachedLookup.sourceNetwork || this.session.state.network,
              account: cachedLookup.account || null,
              balance: cachedLookup.balance || null,
              recentSignatures: cachedLookup.recentSignatures || []
            }
        : await this.solana.getLookupSnapshot(candidate, { limit: batchLimit }).catch(() => null);
        const explorerPromise = useCachedLookup
          ? Promise.resolve(cachedLookup.explorerSnapshot || null)
          : lookupSnapshot?.sourceNetwork === "mainnet-beta" && this.solana.solscanApiKey
            ? this.solana.getExplorerSnapshot(candidate, { limit: batchLimit }).catch(() => null)
            : Promise.resolve(null);
        let transactionBatch = null;
        const batchPromise = needsTransactionBatch && Array.isArray(lookupSnapshot?.recentSignatures) && lookupSnapshot.recentSignatures.length
          ? Promise.all(lookupSnapshot.recentSignatures.slice(0, batchLimit).map(async (entry) => ({
              signature: entry.signature,
              slot: entry.slot,
              confirmationStatus: entry.confirmationStatus || null,
              blockTime: entry.blockTime || null,
              err: entry.err || null,
              summary: await this.solana.getTransactionSummary(entry.signature).catch(() => null)
            })))
          : Promise.resolve(null);
        const [explorerSnapshot, batchTransactions] = await Promise.all([explorerPromise, batchPromise]);
        if (Array.isArray(batchTransactions) && batchTransactions.length) {
          const signatures = lookupSnapshot.recentSignatures.slice(0, batchLimit);
          transactionBatch = {
            address: candidate,
            sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
            signatures,
            transactions: batchTransactions,
            lookupSnapshot,
            explorerSnapshot
          };
          if (this.session.rememberTransactionBatch) {
            this.session.rememberTransactionBatch({
              ...transactionBatch,
              prompt: text
            });
          }
          if (this.session.rememberSolanaLookup) {
            this.session.rememberSolanaLookup({
              address: candidate,
              sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
              lookupSnapshot,
              explorerSnapshot,
              recentSignatures: signatures,
              transactionBatch
            });
          }
        }
        if (useCachedLookup && !transactionBatch) {
          transactionBatch = cachedLookup.transactionBatch || null;
        }
        targets.push({
          kind: "address",
          target: candidate,
          sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
          lookupSnapshot,
          explorerSnapshot,
          transactionBatch
        });
        continue;
      }

      if (isLikelySolanaSignature(candidate)) {
        const transactionActions = this.solana.solscanApiKey
          ? await this.solana.getSolscanTransactionActions(candidate).catch(() => null)
          : null;
        const transactionDetail = this.solana.solscanApiKey && !transactionActions
          ? await this.solana.getSolscanTransactionDetail(candidate).catch(() => null)
          : transactionActions;
        const rpcTransaction = !transactionDetail
          ? await this.solana.getTransactionSummary(candidate).catch(() => null)
          : null;
        targets.push({
          kind: "signature",
          target: candidate,
          sourceNetwork: this.session.state.network,
          transactionActions,
          transactionDetail,
          rpcTransaction
        });
      }
    }

    return {
      recentConversation: (this.session.state.history || []).slice(-4).map((entry) => ({
        role: entry.role,
        content: String(entry.content || "").slice(0, 300)
      })),
      memory: relevantMemory ? {
        kind: relevantMemory.kind,
        score: Number(relevantMemory.score.toFixed(3)),
        item: relevantMemory.item
      } : null,
      targets
    };
  }

  async executePrompt(prompt) {
    const target = extractSolanaCandidate(prompt);
    const memory = this.session.getMemory ? this.session.getMemory() : (this.session.state.memory || {});
    const relevantMemory = selectRelevantSolanaMemory(prompt, memory);
    const promptController = new AbortController();
    this.currentPromptController = promptController;

    // Implicit address: if prompt has no Solana candidate but references data we'd have
    // from a recently analyzed address, resolve that address as the implicit target.
    let effectiveTarget = target;
    let isImplicitTarget = false;
    if (!effectiveTarget) {
      const lastAddr = memory.solana?.lastAddress;
      const lowerPrompt = prompt.toLowerCase();
      const isWatchRequest = ["watch", "monitor", "track", "observe", "alert me", "notify me"].some(p => lowerPrompt.includes(p));
      if (lastAddr && !isWatchRequest && looksLikeSolanaEvidenceTask(prompt) && isValidSolanaAddress(lastAddr)) {
        effectiveTarget = lastAddr;
        isImplicitTarget = true;
      }
    }


    try {
      const cachedBatchCandidate = !effectiveTarget &&
        relevantMemory?.kind === "transaction-batch" &&
        promptNeedsTransactionBatch(prompt) &&
        relevantMemory.item &&
        Array.isArray(relevantMemory.item.transactions) &&
        cachedBatchMeetsRequest(relevantMemory.item, prompt)
          ? relevantMemory.item
          : null;

      if (cachedBatchCandidate) {
      printStep("1/3", "Reusing cached transaction batch");
      printStepDetail(
        `address  ${cachedBatchCandidate.address || relevantMemory.item.lastAddress || "unknown"}`,
        `network  ${cachedBatchCandidate.sourceNetwork || this.session.state.network}`,
        `source  session cache`
      );

      const summaryInput = {
        prompt,
        target: cachedBatchCandidate.address || relevantMemory.item.lastAddress || null,
        kind: "address",
        sourceNetwork: cachedBatchCandidate.sourceNetwork || this.session.state.network,
        explorer: cachedBatchCandidate.explorerSnapshot || null,
        transactionActions: null,
        transactionDetail: null,
        rpcTransaction: null,
        account: cachedBatchCandidate.lookupSnapshot?.account || null,
        balance: cachedBatchCandidate.lookupSnapshot?.balance || null,
        recentSignatures: cachedBatchCandidate.signatures || cachedBatchCandidate.lookupSnapshot?.recentSignatures || [],
        recentTransactions: cachedBatchCandidate.transactions || []
      };

      printStep("2/3", "Summarizing the cached snapshot through the harness");
      printStepDetail(
        `model  ${this.session.state.model}`,
        "mode  cached transaction batch"
      );

      const lookupPrompt = [
        `User request: ${prompt}`,
        `Target: ${summaryInput.target}`,
        "Source: cached transaction batch from the current session.",
        "Summarize only the provided evidence.",
        JSON.stringify(trimSummaryInput(summaryInput))
      ].join("\n");

      this.graphHarness.model = this.session.state.model;
      const startedAt = Date.now();
      const response = await withSpinner(
        () => this.graphHarness.runPrompt(this.context(), lookupPrompt, {
          mode: "lookup",
          useTools: false,
          signal: this.currentPromptController?.signal
        }),
        { message: "summarizing cached snapshot" }
      );
      const elapsedMs = Date.now() - startedAt;
      this.session.appendHistory("user", prompt);
      this.session.appendHistory("assistant", response);
      if (summaryInput.target) {
        this.session.rememberSolanaLookup({
          address: summaryInput.target,
          sourceNetwork: summaryInput.sourceNetwork,
          lookupSnapshot: cachedBatchCandidate.lookupSnapshot || null,
          explorerSnapshot: cachedBatchCandidate.explorerSnapshot || null,
          balance: summaryInput.balance,
          account: summaryInput.account,
          recentSignatures: summaryInput.recentSignatures,
          transactionBatch: cachedBatchCandidate
        });
      }
      await this.session.save();
        printAssistant(response, { model: this.session.state.model, elapsedMs, compact: true });
        return;
      }

      let plan;
      try {
          plan = await withSpinner(
            () => this.graphHarness.decomposePrompt(this.context(), prompt, {
              hasTarget: Boolean(effectiveTarget),
              target: effectiveTarget || undefined
            }),
            { message: "planning reply" }
          );
      } catch {
        plan = {
          mode: "answer",
          title: "Direct answer",
          summary: "Planning fell back to a direct answer.",
          needsBackground: false,
          steps: [{ title: "Answer directly", goal: prompt }]
        };
      }

    const planSteps = Array.isArray(plan.steps) && plan.steps.length ? plan.steps : [{ title: "Answer directly", goal: prompt }];
    const resolvedLookup = plan.mode === "lookup" && effectiveTarget && (isValidSolanaAddress(effectiveTarget) || isLikelySolanaSignature(effectiveTarget));
    if (!resolvedLookup && (plan.mode !== "answer" || plan.needsBackground || planSteps.length > 1)) {
      printPlan(
        `${plan.title} · ${planSteps.length} step${planSteps.length === 1 ? "" : "s"}${plan.needsBackground ? " · background" : ""}`,
        plan.summary || "Orion will split the work into smaller steps.",
        planSteps.slice(0, 4)
      );
    }

      if (plan.mode === "watch") {
      const watchAnalysis = classifyLongHorizon(prompt);
      const watchTarget =
        extractSolanaCandidate(prompt) ||
        (this.session.state.currentWallet || null) ||
        null;

      if (!watchTarget) {
        const task = await this.queueTask(prompt, plan);
        this.session.appendHistory("user", prompt);
        this.session.appendHistory("assistant", `Queued a durable task: ${task.title}.`);
        await this.session.save();
        printNotice(`Queued background task ${task.id.slice(0, 8)}.`);
        printPanel("Queued Task", [
          `Task: ${task.id}`,
          `Title: ${task.title}`,
          `Plan: ${planSteps.length} step${planSteps.length === 1 ? "" : "s"}`,
          ...planSteps.slice(0, 4).map((step, index) => `${index + 1}. ${step.title} — ${step.goal}`),
          "No valid Solana target was identified, so Orion queued a general long-horizon task instead."
        ]);
        return;
      }

      const task = await this.queueWatchTask({
        watchType: watchAnalysis?.watchType || (isLikelySolanaSignature(watchTarget) ? "signature" : "account"),
        target: watchTarget,
        prompt
      });
      this.session.appendHistory("user", prompt);
      this.session.appendHistory("assistant", `Queued a ${task.watchType} watch task for ${watchTarget || "the requested target"}.`);
      await this.session.save();
      printNotice(`Queued watch task ${task.id.slice(0, 8)} (${task.watchType}).`);
      printPanel("Queued Watch", [
        `Task: ${task.id}`,
        `Type: ${task.watchType}`,
        `Target: ${task.target}`,
        "Orion will keep this watch alive and react to matching Solana events."
      ]);
        return;
      }

      if (resolvedLookup) {
      const isAddress = isValidSolanaAddress(effectiveTarget);
      const isSignature = isLikelySolanaSignature(effectiveTarget);

      if (!isAddress && !isSignature) {
        const message = [
          "That does not look like a valid Solana address or transaction signature.",
          "Paste the exact pubkey or signature and I’ll inspect it without recursive tool loops."
        ].join(" ");
        this.session.appendHistory("user", prompt);
        this.session.appendHistory("assistant", message);
        await this.session.save();
        printAssistant(message, { model: this.session.state.model });
        return;
      }

      printStep("1/3", isAddress ? "Classifying target as a wallet address" : "Classifying target as a transaction signature");
      printStepDetail(
        isAddress ? `address  ${effectiveTarget}` : `signature  ${effectiveTarget.slice(0, 20)}…${effectiveTarget.slice(-8)}`,
        `network  ${this.session.state.network}`
      );

      const cachedLookup = isAddress ? findCachedLookupForAddress(effectiveTarget, memory) : null;
      const useCachedLookup = Boolean(
        isAddress &&
        cachedLookup &&
        !promptWantsFreshLookup(prompt) &&
        (
          cachedLookup.lookupSnapshot ||
          cachedLookup.balance ||
          cachedLookup.account ||
          cachedLookup.recentSignatures
        )
      );
      const batchLimit = preferredTransactionBatchSize(prompt, 3);
      const lookupSnapshot = useCachedLookup
        ? cachedLookup.lookupSnapshot || {
            address: effectiveTarget,
            sourceNetwork: cachedLookup.sourceNetwork || this.session.state.network,
            account: cachedLookup.account || null,
            balance: cachedLookup.balance || null,
            recentSignatures: cachedLookup.recentSignatures || []
          }
        : isAddress
          ? await this.solana.getLookupSnapshot(effectiveTarget, { limit: batchLimit }).catch(() => null)
          : null;
      const explorerSnapshot = useCachedLookup
        ? cachedLookup.explorerSnapshot || null
        : lookupSnapshot?.sourceNetwork === "mainnet-beta" && this.solana.solscanApiKey
          ? await this.solana.getExplorerSnapshot(effectiveTarget, { limit: batchLimit }).catch(() => null)
          : null;
      const useCachedTransactionBatch = isAddress
        && relevantMemory?.kind === "transaction-batch"
        && relevantMemory.item?.address === effectiveTarget
        && Array.isArray(relevantMemory.item?.transactions)
        && cachedBatchMeetsRequest(relevantMemory.item, prompt);
      let transactionBatch = useCachedTransactionBatch ? relevantMemory.item : null;
      if (useCachedTransactionBatch) {
        this.session.rememberTransactionBatch({
          ...relevantMemory.item,
          prompt
        });
      } else if (isAddress && (relevantMemory || looksLikeSolanaEvidenceTask(prompt)) && Array.isArray(lookupSnapshot?.recentSignatures) && lookupSnapshot.recentSignatures.length) {
        const signatures = lookupSnapshot.recentSignatures.slice(0, batchLimit);
        const transactions = await Promise.all(signatures.map(async (entry) => ({
          signature: entry.signature,
          slot: entry.slot,
          confirmationStatus: entry.confirmationStatus || null,
          blockTime: entry.blockTime || null,
          err: entry.err || null,
          summary: await this.solana.getTransactionSummary(entry.signature).catch(() => null)
        })));
        transactionBatch = {
          address: effectiveTarget,
          sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
          signatures,
          transactions,
          lookupSnapshot,
          explorerSnapshot
        };
        this.session.rememberTransactionBatch({
          ...transactionBatch,
          prompt
        });
      }
      const transactionActions = isSignature && this.solana.solscanApiKey
        ? await this.solana.getSolscanTransactionActions(effectiveTarget).catch(() => null)
        : null;
      const transactionDetail = isSignature && this.solana.solscanApiKey && !transactionActions
        ? await this.solana.getSolscanTransactionDetail(effectiveTarget).catch(() => null)
        : transactionActions;
      const rpcTransaction = isSignature && !transactionDetail
        ? await this.solana.getTransactionSummary(effectiveTarget).catch(() => null)
        : null;
      const account = isAddress ? lookupSnapshot?.account || null : null;
      const balance = isAddress ? lookupSnapshot?.balance || null : null;
      const signatures = isAddress ? lookupSnapshot?.recentSignatures?.slice(0, batchLimit) || [] : [];
      printStep("2/3", this.solana.solscanApiKey
        ? (isAddress ? "Fetching Solscan account snapshot" : "Fetching Solscan transaction summary")
        : (isAddress ? "Fetching Solana RPC account snapshot" : "Fetching Solana RPC transaction summary"));
      if (isAddress) {
        printStepDetail(
          `source  ${useCachedLookup ? "session cache" : this.solana.solscanApiKey ? "Solscan Pro" : "Solana RPC"}`,
          balance != null ? `balance  ${formatSolAmount(balance) || "pending"}` : "balance  pending",
          signatures.length ? `signatures  ${signatures.length} retrieved` : "signatures  none found",
          transactionBatch?.transactions?.length ? `transactions  ${transactionBatch.transactions.length} cached for follow-up analysis` : ""
        );
      } else {
        printStepDetail(
          `source  ${this.solana.solscanApiKey ? "Solscan Pro" : "Solana RPC"}`,
          transactionDetail ? "detail  loaded" : rpcTransaction ? "detail  rpc fallback" : "detail  unavailable"
        );
      }
      const summaryInput = {
        prompt,
        target: effectiveTarget,
        kind: isAddress ? "address" : "signature",
        sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
        explorer: explorerSnapshot,
        transactionActions,
        transactionDetail,
        rpcTransaction,
        account,
        balance,
        recentSignatures: signatures,
        recentTransactions: transactionBatch?.transactions || null
      };

      printStep("3/3", "Summarizing the prefetched snapshot through the harness");
      printStepDetail(
        `model  ${this.session.state.model}`,
        transactionDetail ? "mode  transaction summary" : explorerSnapshot ? "mode  explorer snapshot" : "mode  rpc snapshot"
      );

      const lookupPrompt = [
        `User request: ${prompt}`,
        `Target: ${effectiveTarget}`,
        transactionDetail
          ? "Source: Solscan transaction detail/actions."
          : explorerSnapshot
            ? "Source: Solscan Pro API snapshot."
            : "Source: Solana RPC snapshot.",
        "Summarize only the provided evidence.",
        JSON.stringify(trimSummaryInput(summaryInput))
      ].filter(Boolean).join("\n");

      let response;
      try {
        this.graphHarness.model = this.session.state.model;
        response = await withSpinner(
          () =>
            this.graphHarness.runPrompt(this.context(), lookupPrompt, {
              mode: "lookup",
              useTools: false,
              signal: this.currentPromptController?.signal
            }),
          { message: transactionDetail ? "summarizing transaction snapshot" : "summarizing account snapshot" }
        );
      } catch (error) {
        const message = error?.message || String(error);
        response = [
          "Lookup mode could not reach the harness model.",
          `Error: ${message}`,
          "",
          JSON.stringify(summaryInput, null, 2)
        ].join("\n");
      }

      this.session.appendHistory("user", prompt);
      this.session.appendHistory("assistant", response);
      if (isAddress) {
        this.session.rememberSolanaLookup({
          address: effectiveTarget,
          sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
          lookupSnapshot,
          explorerSnapshot,
          balance,
          account,
          recentSignatures: signatures,
          transactionBatch
        });
      }
      await this.session.save();
      printAssistant(response, { model: this.session.state.model, compact: true });
        return;
      }

      if (plan.needsBackground || plan.mode === "task" || planSteps.length > 1) {
        await this.executeInlineSteps(prompt, plan);
        return;
      }

      this.graphHarness.model = this.session.state.model;
      const startedAt = Date.now();

      const response = await withSpinner(
        () => this.graphHarness.runPrompt(this.context(), prompt, {
          signal: this.currentPromptController?.signal
        }),
        { message: "thinking through reply" }
      );
      const elapsedMs = Date.now() - startedAt;

      this.session.appendHistory("user", prompt);
      this.session.appendHistory("assistant", response);
      await this.session.save();
      printAssistant(response, { model: this.session.state.model, elapsedMs });
    } finally {
      if (this.currentPromptController === promptController) {
        this.currentPromptController = null;
      }
    }
  }

  async executeInlineSteps(prompt, plan) {
    const steps = Array.isArray(plan?.steps) && plan.steps.length
      ? plan.steps
      : [{ title: "Answer directly", goal: prompt }];

    // Pull Solana addresses from recent history so steps never ask for what's already known
    const recentText = (this.session.state.history || []).slice(-6)
      .map(m => String(m.content || "")).join(" ") + " " + prompt;
    const recentAddresses = [...new Set((recentText.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || []))];
    const addressContext = recentAddresses.length
      ? `Addresses already in context (use these, do not ask the user): ${recentAddresses.join(", ")}`
      : "";

    // Build a readable conversation summary for steps that need prior context
    const historyContext = (this.session.state.history || []).slice(-4)
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 300)}`)
      .join("\n");
    const taskEvidence = await this.buildSolanaEvidence(`${prompt}\n${steps.map((step) => `${step.title}\n${step.goal || ""}`).join("\n")}`).catch(() => ({ recentConversation: [], targets: [] }));

    const stepResults = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      printStep(`${i + 1}/${steps.length}`, step.title);
      if (step.goal && step.goal !== step.title) printStepDetail(step.goal);
      if (addressContext) printStepDetail(addressContext.replace("Addresses already in context (use these, do not ask the user): ", "addresses  "));

      const stepPrompt = [
        `Original goal: ${prompt}`,
        historyContext ? `Recent conversation:\n${historyContext}` : "",
        addressContext,
        `Step ${i + 1}/${steps.length}: ${step.title}`,
        `Step goal: ${step.goal || step.title}`,
        taskEvidence.targets.length ? `Evidence JSON:\n${JSON.stringify(taskEvidence, null, 2)}` : "",
        stepResults.length
          ? `Context from prior steps:\n${stepResults.map((r, idx) => `${idx + 1}. ${r.title}: ${r.response.slice(0, 300)}`).join("\n")}`
          : "",
        taskEvidence.targets.length
          ? "Focus only on this step. Use the prefetched evidence above. Do NOT call tools."
          : "Focus only on this step. Return a concrete result. Do NOT ask the user for information — use what is already provided above."
      ].filter(Boolean).join("\n\n");

      try {
        this.graphHarness.model = this.session.state.model;
        const response = await withSpinner(
          () => this.graphHarness.runPrompt(this.context(), stepPrompt, {
            mode: "task",
            useTools: taskEvidence.targets.length === 0,
            recursionLimit: taskEvidence.targets.length ? 12 : config.graphRecursionLimit,
            signal: this.currentPromptController?.signal
          }),
          { message: step.title }
        );
        const brief = response.split("\n").find(l => l.trim()) || "";
        if (brief) printStepDetail(brief.length > 100 ? brief.slice(0, 100) + "…" : brief);
        stepResults.push({ title: step.title, response });
      } catch (err) {
        printError(new Error(`Step ${i + 1} failed: ${err.message}`));
        stepResults.push({ title: step.title, response: `Step failed: ${err.message}` });
      }
    }

    let finalResponse;
    if (stepResults.length === 1) {
      finalResponse = stepResults[0].response;
    } else {
      const synthesisPrompt = [
        `Original goal: ${prompt}`,
        addressContext,
        taskEvidence.targets.length ? `Evidence JSON:\n${JSON.stringify(taskEvidence, null, 2)}` : "",
        "Step results:",
        ...stepResults.map((r, i) => `${i + 1}. ${r.title}:\n${r.response}`)
      ].filter(Boolean).join("\n");
      try {
        this.graphHarness.model = this.session.state.model;
        finalResponse = await withSpinner(
          () => this.graphHarness.runPrompt(this.context(), synthesisPrompt, {
            mode: "task",
            useTools: false,
            recursionLimit: 8,
            signal: this.currentPromptController?.signal
          }),
          { message: "synthesizing" }
        );
      } catch {
        finalResponse = stepResults.map(r => `${r.title}:\n${r.response}`).join("\n\n");
      }
    }

    this.session.appendHistory("user", prompt);
    this.session.appendHistory("assistant", finalResponse);
    await this.session.save();
    printAssistant(finalResponse, { model: this.session.state.model, compact: false });
  }

  async executeTask(prompt) {
    const taskController = new AbortController();
    this.currentPromptController = taskController;
    try {
      this.graphHarness.model = this.session.state.model;
      const task = await withSpinner(
        () => this.graphHarness.runTask(this.context(), prompt, {
          threadId: `orion-task-${this.session.state.sessionId || "session"}`,
          recursionLimit: config.graphRecursionLimit,
          signal: this.currentPromptController?.signal
        }),
        { message: "working through task" }
      );
      const lines = task.updates.map((update, index) => `step ${index + 1}: ${JSON.stringify(update)}`);
      printPanel("Task Progress", lines.length ? lines : ["No streamed updates captured."]);
      this.session.appendHistory("user", `task: ${prompt}`);
      this.session.appendHistory("assistant", task.response);
      await this.session.save();
      printAssistant(task.response);
    } finally {
      if (this.currentPromptController === taskController) {
        this.currentPromptController = null;
      }
    }
  }

  async queueTask(prompt, plan = null) {
    return this.taskStore.create({
      type: "graph",
      title: prompt.slice(0, 80),
      prompt,
      status: "queued",
      plan,
      steps: Array.isArray(plan?.steps) && plan.steps.length
        ? plan.steps
        : [{ title: "Answer directly", goal: prompt }]
    });
  }

  async queueWatchTask({ watchType, target, prompt = "" }) {
    const task = await this.taskStore.create({
      type: "watch",
      watchType,
      target,
      prompt,
      status: "waiting",
      title: `${watchType} watch: ${target}`
    });
    await this.startWatchTask(task);
    return task;
  }

  async listTasks() {
    return this.taskStore.list();
  }

  async getTask(taskId) {
    return this.taskStore.get(taskId);
  }

  async cancelTask(taskId) {
    const task = await this.taskStore.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    await this.stopWatchTask(taskId);
    return this.taskStore.update(taskId, {
      status: "cancelled",
      cancelledAt: new Date().toISOString()
    });
  }

  async resumeTask(taskId) {
    const task = await this.taskStore.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.type === "watch") {
      const next = await this.taskStore.update(taskId, {
        status: "waiting",
        completedAt: null,
        lastError: null
      });
      await this.startWatchTask(next);
      return next;
    }

    return this.taskStore.update(taskId, {
      status: "queued",
      completedAt: null,
      lastError: null
    });
  }

  startTaskLoop() {
    if (this.taskLoop) {
      clearInterval(this.taskLoop);
    }
    this.taskLoop = setInterval(() => {
      this.processTaskQueue().catch(() => {});
    }, config.taskPollIntervalMs);
  }

  async processTaskQueue() {
    if (this.activeTaskId) {
      return;
    }

    const tasks = await this.taskStore.list();
    const nextTask = tasks
      .slice()
      .reverse()
      .find((task) => task.type === "graph" && task.status === "queued");
    if (!nextTask) {
      return;
    }

    this.activeTaskId = nextTask.id;
    await this.taskStore.update(nextTask.id, {
      status: "running",
      startedAt: new Date().toISOString()
    });

    try {
      const stepPlan = Array.isArray(nextTask.steps) && nextTask.steps.length
        ? nextTask.steps
        : [{ title: "Answer directly", goal: nextTask.prompt }];
      const stepResults = [];
      const taskEvidence = await this.buildSolanaEvidence(`${nextTask.prompt}\n${stepPlan.map((step) => `${step.title}\n${step.goal || ""}`).join("\n")}`).catch(() => ({ recentConversation: [], targets: [] }));

      for (let i = 0; i < stepPlan.length; i += 1) {
        const step = stepPlan[i];
        const stepIndex = i + 1;
        const stepPrompt = [
          `Original goal: ${nextTask.prompt}`,
          `Current step ${stepIndex}/${stepPlan.length}: ${step.title}`,
          `Step goal: ${step.goal}`,
          taskEvidence.targets.length ? `Evidence JSON:\n${JSON.stringify(taskEvidence, null, 2)}` : "",
          stepResults.length
            ? `Previous step summaries:\n${stepResults.map((entry, index) => `${index + 1}. ${entry.title}: ${entry.response}`).join("\n")}`
            : "",
          taskEvidence.targets.length
            ? "Work only on this step. Use the prefetched evidence above. Do NOT call tools."
            : "Work only on this step. Return a concrete result for the step before moving on."
        ].filter(Boolean).join("\n\n");

        printStep("task", `${nextTask.id.slice(0, 8)} step ${stepIndex}/${stepPlan.length} · ${step.title}`);
        await this.taskStore.appendHistory(nextTask.id, {
          type: "step_start",
          payload: {
            index: stepIndex,
            total: stepPlan.length,
            title: step.title,
            goal: step.goal
          }
        });

        const result = await this.graphHarness.runTask(this.context(), stepPrompt, {
          threadId: `${nextTask.threadId}-step-${stepIndex}`,
          recursionLimit: taskEvidence.targets.length ? 12 : config.graphRecursionLimit,
          onUpdate: async (update) => {
            await this.taskStore.appendHistory(nextTask.id, {
              type: "update",
              payload: {
                step: stepIndex,
                update
              }
            });
            printStep("task", `${nextTask.id.slice(0, 8)} ${JSON.stringify(update).slice(0, 180)}`);
          }
        });

        stepResults.push({
          title: step.title,
          response: result.response,
          updates: result.updates
        });

        await this.taskStore.appendHistory(nextTask.id, {
          type: "step_result",
          payload: {
            index: stepIndex,
            title: step.title,
            response: result.response
          }
        });
      }

      const synthesisPrompt = [
        `Original goal: ${nextTask.prompt}`,
        `Task plan: ${JSON.stringify(stepPlan, null, 2)}`,
        taskEvidence.targets.length ? `Evidence JSON:\n${JSON.stringify(taskEvidence, null, 2)}` : "",
        `Step results: ${JSON.stringify(stepResults.map((entry) => ({ title: entry.title, response: entry.response })), null, 2)}`,
        "Summarize exactly what was done, what was learned, and what the user should do next. Be concise and concrete."
      ].join("\n\n");
      const result = stepResults.length > 1
        ? {
            updates: stepResults.flatMap((entry) => entry.updates || []),
            response: await this.graphHarness.runPrompt(this.context(), synthesisPrompt, {
              mode: "task",
              useTools: false,
              recursionLimit: 8
            })
          }
        : stepResults[0];

      await this.taskStore.update(nextTask.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        resultSummary: result.response
      });
      printNotice(`Task ${nextTask.id.slice(0, 8)} completed.`);
      printPanel("Task Report", [
        `Task: ${nextTask.id}`,
        `Title: ${nextTask.title || "n/a"}`,
        `Prompt: ${nextTask.prompt || "n/a"}`,
        "",
        "What Orion tried:",
        ...stepResults.map((entry, index) => `${index + 1}. ${entry.title}: ${entry.response.slice(0, 180)}`),
        "",
        "Final summary:",
        result.response
      ].filter(Boolean));
    } catch (error) {
      await this.taskStore.update(nextTask.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        lastError: error.message
      });
      printError(new Error(`Task ${nextTask.id.slice(0, 8)} failed: ${error.message}`));
    } finally {
      this.activeTaskId = null;
    }
  }

  async startWatchTask(task) {
    if (!task || this.watchDisposers.has(task.id) || task.status === "cancelled") {
      return;
    }

    if (!isValidWatchTarget(task.watchType, task.target)) {
      await this.taskStore.update(task.id, {
        status: "failed",
        lastError: `Invalid ${task.watchType} target: ${task.target}`
      });
      return;
    }

    const handleEvent = async (payload) => {
      await this.taskStore.appendHistory(task.id, {
        type: "event",
        payload
      });

      await this.taskStore.update(task.id, (current) => ({
        eventCount: (current.eventCount || 0) + 1,
        lastEventAt: new Date().toISOString(),
        lastEventSummary: JSON.stringify(payload).slice(0, 240)
      }));

      if (task.prompt) {
        await this.taskStore.update(task.id, { status: "running" });
        try {
        const result = await this.graphHarness.runTask(
          this.context(),
          `${task.prompt}\n\nWatch event payload:\n${JSON.stringify(payload, null, 2)}`,
          {
            threadId: task.threadId,
            signal: this.currentPromptController?.signal,
            onUpdate: async (update) => {
              await this.taskStore.appendHistory(task.id, {
                type: "analysis",
                payload: update
                });
              }
            }
          );
          await this.taskStore.update(task.id, {
            resultSummary: result.response,
            status: task.watchType === "signature" ? "completed" : "waiting"
          });
        } catch (error) {
          await this.taskStore.update(task.id, {
            status: "failed",
            lastError: error.message
          });
        }
      } else if (task.watchType === "signature") {
        await this.taskStore.update(task.id, {
          status: "completed",
          completedAt: new Date().toISOString()
        });
      }

      if (task.watchType === "signature") {
        await this.stopWatchTask(task.id);
      }
    };

    let dispose;
    if (task.watchType === "account") {
      dispose = await this.solana.watchAccount(task.target, handleEvent);
    } else if (task.watchType === "signature") {
      dispose = await this.solana.watchSignature(task.target, handleEvent);
    } else if (task.watchType === "logs") {
      dispose = await this.solana.watchLogs(task.target === "all" ? "" : task.target, handleEvent);
    } else {
      throw new Error(`Unsupported watch type: ${task.watchType}`);
    }

    this.watchDisposers.set(task.id, dispose);
  }

  async stopWatchTask(taskId) {
    const dispose = this.watchDisposers.get(taskId);
    if (!dispose) {
      return;
    }
    await dispose();
    this.watchDisposers.delete(taskId);
  }

  async resumeWatchTasks() {
    const tasks = await this.taskStore.list();
    for (const task of tasks) {
      if (task.type === "watch" && (task.status === "waiting" || task.status === "running")) {
        try {
          await this.startWatchTask(task);
        } catch (error) {
          await this.taskStore.update(task.id, {
            status: "failed",
            lastError: error.message
          });
        }
      }
    }
  }

  async loop() {
    emitKeypressEvents(input);
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }

    this.onKeypress = (_str, key) => {
      if (key?.name !== "escape") {
        return;
      }

      if (this.currentPromptController && !this.currentPromptController.signal.aborted) {
        this.currentPromptController.abort(new Error("Cancelled by Esc"));
        return;
      }

      if (this.pendingQuestionController && !this.pendingQuestionController.signal.aborted) {
        this.pendingQuestionController.abort(new Error("Cancelled by Esc"));
      }
    };
    input.on("keypress", this.onKeypress);

    this.rl.on("SIGINT", () => {
      output.write("\n");
      this.rl.write(null, { ctrl: true, name: "u" });
    });

    while (true) {
      output.write(`\n${turnHeader(this.session.state, { ollamaBaseUrl: this.ollama?.baseUrl })}\n`);
      output.write(`${promptRule(this.session.state.network)}\n`);

      // Pre-draw bottom chrome below where ❯ will appear, then reposition cursor up
      output.write(`\n${rule(C.border)}\n${turnFooterHint()}\n`);
      output.write("\x1b[3A\r");

      let line;
      this.pendingQuestionController = new AbortController();
      try {
        line = await this.rl.question(promptMarker(), {
          signal: this.pendingQuestionController.signal
        });
      } catch {
        line = "";
      } finally {
        this.pendingQuestionController = null;
      }

      // After Enter, cursor is at the bottom rule line. Erase bottom chrome + readline echo.
      output.write("\r\x1b[2K");           // clear bottom rule line
      output.write("\x1b[B\r\x1b[2K");    // cursor down → clear hint line
      output.write("\x1b[B\r\x1b[2K");    // cursor down → clear trailing blank
      output.write("\x1b[3A\r\x1b[2K");   // cursor up 3 → clear readline echo line

      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      printUserEcho(trimmed);

      try {
        if (trimmed.startsWith("/")) {
          const outcome = await this.executeCommand(trimmed);
          if (outcome?.type === "exit") {
            break;
          }
          renderOutcome(outcome);
          continue;
        }

        await this.executePrompt(trimmed);
      } catch (error) {
        if (isAbortError(error)) {
          printNotice("Prompt cancelled.");
          continue;
        }
        printError(error);
      }
    }
  }

  async close() {
    if (this.onKeypress) {
      input.off("keypress", this.onKeypress);
      this.onKeypress = null;
    }
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(false);
    }
    if (this.taskLoop) {
      clearInterval(this.taskLoop);
      this.taskLoop = null;
    }
    for (const taskId of Array.from(this.watchDisposers.keys())) {
      await this.stopWatchTask(taskId);
    }
    await this.session.save();
    this.rl.close();
  }
}
