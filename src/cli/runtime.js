import readline from "node:readline/promises";
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
import { printAssistant, printError, printNotice, printPanel, printPlan, printStep, printSummary, printUserEcho } from "./renderer.js";
import { HarnessSession } from "./runtime-session.js";
import { runShellCommand } from "./shell-tool.js";
import { TaskStore } from "./task-store.js";
import { muted, success } from "./theme.js";
import { buildToolRegistry } from "./tool-registry.js";
import { promptMarker, promptRule, turnFooterHint, turnHeader, withSpinner } from "./ui.js";

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

function looksLikeSolanaLookupPrompt(prompt) {
  const text = String(prompt).toLowerCase();
  return [
    "tell me",
    "what do you know",
    "what can you tell",
    "what about",
    "anything about",
    "details on",
    "look up",
    "inspect",
    "analyze",
    "look at",
    "who is",
    "summarize",
    "what is this"
  ].some((phrase) => text.includes(phrase));
}

function shouldDirectLookup(prompt, target) {
  if (!target) {
    return false;
  }

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

  if (watchSignals.some((phrase) => text.includes(phrase))) {
    return false;
  }

  return looksLikeSolanaLookupPrompt(prompt) || text.includes(target.toLowerCase());
}

function isValidWatchTarget(watchType, target) {
  if (watchType === "logs") {
    return true;
  }
  return Boolean(extractSolanaCandidate(target));
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
    this.chromeHidden = false;
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

  async executePrompt(prompt) {
    const target = extractSolanaCandidate(prompt);
    let plan;
    try {
      plan = await withSpinner(
        () => this.graphHarness.decomposePrompt(this.context(), prompt),
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
    const resolvedLookup = shouldDirectLookup(prompt, target) && (isValidSolanaAddress(target) || isLikelySolanaSignature(target));
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
      const isAddress = isValidSolanaAddress(target);
      const isSignature = isLikelySolanaSignature(target);

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

      const lookupSnapshot = isAddress
        ? await this.solana.getLookupSnapshot(target, { limit: 10 }).catch(() => null)
        : null;
      const explorerSnapshot = lookupSnapshot?.sourceNetwork === "mainnet-beta" && this.solana.solscanApiKey
        ? await this.solana.getExplorerSnapshot(target, { limit: 10 }).catch(() => null)
        : null;
      const transactionActions = isSignature && this.solana.solscanApiKey
        ? await this.solana.getSolscanTransactionActions(target).catch(() => null)
        : null;
      const transactionDetail = isSignature && this.solana.solscanApiKey && !transactionActions
        ? await this.solana.getSolscanTransactionDetail(target).catch(() => null)
        : transactionActions;
      const rpcTransaction = isSignature && !transactionDetail
        ? await this.solana.getTransactionSummary(target).catch(() => null)
        : null;
      const account = isAddress ? lookupSnapshot?.account || null : null;
      const balance = isAddress ? lookupSnapshot?.balance || null : null;
      const signatures = isAddress ? lookupSnapshot?.recentSignatures || [] : [];
      printStep("2/3", this.solana.solscanApiKey
        ? (isAddress ? "Fetching Solscan account snapshot" : "Fetching Solscan transaction summary")
        : (isAddress ? "Fetching Solana RPC account snapshot" : "Fetching Solana RPC transaction summary"));
      const summaryInput = {
        prompt,
        target,
        kind: isAddress ? "address" : "signature",
        sourceNetwork: lookupSnapshot?.sourceNetwork || this.session.state.network,
        explorer: explorerSnapshot,
        transactionActions,
        transactionDetail,
        rpcTransaction,
        account,
        balance,
        recentSignatures: signatures
      };

      printStep("3/3", "Summarizing the prefetched snapshot through the harness");

      const lookupPrompt = [
        "Summarize this Solana target snapshot for the operator.",
        "Do not call tools. Use only the provided data.",
        transactionDetail
          ? "Primary source: Solscan transaction detail/actions."
          : explorerSnapshot
            ? "Primary source: Solscan Pro API snapshot."
            : "Primary source: Solana RPC snapshot.",
        transactionDetail ? "This is a transaction signature lookup. Explain the transaction clearly." : "",
        `User request: ${prompt}`,
        `Target: ${target}`,
        "Snapshot JSON:",
        JSON.stringify(summaryInput, null, 2)
      ].filter(Boolean).join("\n");

      let response;
      try {
        this.graphHarness.model = this.session.state.model;
        response = await withSpinner(
          () =>
            this.graphHarness.runPrompt(this.context(), lookupPrompt, {
              mode: "lookup",
              useTools: false
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
      await this.session.save();
      printAssistant(response, { model: this.session.state.model });
      return;
    }

    if (plan.needsBackground || plan.mode === "task" || planSteps.length > 1) {
      const task = await this.queueTask(prompt, plan);
      this.session.appendHistory("user", prompt);
      this.session.appendHistory("assistant", `Queued a durable task: ${task.title}.`);
      await this.session.save();
      printNotice(`Queued background task ${task.id.slice(0, 8)}.`);
      printPanel("Queued Task", [
        `Task: ${task.id}`,
        `Title: ${task.title}`,
        `Plan: ${planSteps.length} step${planSteps.length === 1 ? "" : "s"}`,
        ...planSteps.slice(0, 4).map((step, index) => `${index + 1}. ${step.title}`),
        "Orion will work this in the background, split it into steps, try tools as needed, and surface progress later in this terminal."
      ]);
      return;
    }

    this.graphHarness.model = this.session.state.model;
    const startedAt = Date.now();
    const response = await withSpinner(
      () => this.graphHarness.runPrompt(this.context(), prompt),
      { message: "thinking through reply" }
    );
    const elapsedMs = Date.now() - startedAt;

    this.session.appendHistory("user", prompt);
    this.session.appendHistory("assistant", response);
    await this.session.save();
    printAssistant(response, { model: this.session.state.model, elapsedMs });
  }

  async executeTask(prompt) {
    this.graphHarness.model = this.session.state.model;
    const task = await withSpinner(
      () => this.graphHarness.runTask(this.context(), prompt),
      { message: "working through task" }
    );
    const lines = task.updates.map((update, index) => `step ${index + 1}: ${JSON.stringify(update)}`);
    printPanel("Task Progress", lines.length ? lines : ["No streamed updates captured."]);
    this.session.appendHistory("user", `task: ${prompt}`);
    this.session.appendHistory("assistant", task.response);
    await this.session.save();
    printAssistant(task.response);
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

      for (let i = 0; i < stepPlan.length; i += 1) {
        const step = stepPlan[i];
        const stepIndex = i + 1;
        const stepPrompt = [
          `Original goal: ${nextTask.prompt}`,
          `Current step ${stepIndex}/${stepPlan.length}: ${step.title}`,
          `Step goal: ${step.goal}`,
          stepResults.length
            ? `Previous step summaries:\n${stepResults.map((entry, index) => `${index + 1}. ${entry.title}: ${entry.response}`).join("\n")}`
            : "",
          "Work only on this step. Return a concrete result for the step before moving on."
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
        `Step results: ${JSON.stringify(stepResults.map((entry) => ({ title: entry.title, response: entry.response })), null, 2)}`,
        "Summarize exactly what was done, what was learned, and what the user should do next. Be concise and concrete."
      ].join("\n\n");
      const result = stepResults.length > 1
        ? {
            updates: stepResults.flatMap((entry) => entry.updates || []),
            response: await this.graphHarness.runPrompt(this.context(), synthesisPrompt, {
              mode: "task",
              useTools: false
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
    this.rl.on("SIGINT", () => {
      output.write("\n");
      this.rl.write(null, { ctrl: true, name: "u" });
    });

    while (true) {
      if (!this.chromeHidden) {
        output.write(`\n${turnHeader(this.session.state)}\n`);
        output.write(`${promptRule()}\n`);
        output.write(`${turnFooterHint()}\n`);
      }

      let line;
      try {
        line = await this.rl.question(promptMarker());
      } catch {
        line = "";
      }

      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (!this.chromeHidden) {
        output.write("\x1b[2J\x1b[H");
        this.chromeHidden = true;
      }
      output.write("\n");
      printUserEcho(trimmed);
      output.write("\n");

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
        printError(error);
      }
    }
  }

  async close() {
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
