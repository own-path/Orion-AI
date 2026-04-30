import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { END, MemorySaver, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { config } from "../../services/shared/config.js";
import { buildLangGraphTools } from "./langgraph-tools.js";
import { SOLANA_DEV_SKILL } from "./solana-skill.js";

function buildSystemPrompt(session, mode = "chat") {
  const recent = (session.state.history || []).slice(-10).map((entry) => {
    const role = entry.role === "user" ? "User" : "Assistant";
    const limit = entry.role === "user" ? 400 : 600;
    return `${role}: ${String(entry.content || "").slice(0, limit)}`;
  });
  const taskHint =
    mode === "task"
      ? "You are running a longer multi-step DeFi and Solana learning task. Decompose the goal, use tools when needed, keep the work grounded in on-chain facts, and return a concrete result."
      : mode === "lookup"
      ? "You are summarizing a pre-fetched Solana target snapshot. Do not call tools. Answer only from the provided data."
        : "You are answering in standard operator mode. Be concise, tool-aware, and explain only when asked.";

  if (mode === "lookup") {
    return [
      "You are ORION, an agentic DeFi CLI for Solana learners and operators.",
      taskHint,
      "Use only the provided snapshot. Be concise and factual. No markdown, no headings, no capability lists.",
      "Return EXACTLY 4 to 8 lines. Every line MUST follow this format: Label: value — a short label, a colon, a space, then the value. No intro sentence, no prose, no blank lines, no commentary.",
      "Choose the most important fields: Address, Balance, Network, Owner, Recent Transactions, Executable, Token Accounts, Fees, Error (if any).",
      "When a field is unavailable say 'unavailable' as the value. Never guess or invent data.",
      `Current network: ${session.state.network}`,
      `Current RPC: ${session.state.rpcUrl}`,
      `Current wallet: ${session.state.currentWallet || "none selected"}`,
      recent.length ? `Recent conversation:\n${recent.join("\n")}` : ""
    ].filter(Boolean).join(" ");
  }

  return [
    "You are ORION, an agentic DeFi CLI for Solana learners and operators.",
    taskHint,
    SOLANA_DEV_SKILL,
    "Use short, direct, and visually clean formatting. Do not dump capability lists, headings, or long preambles unless the user explicitly asks for a breakdown. Prefer one short answer paragraph, then at most a few bullets if they add value.",
    "CRITICAL: Never use Markdown in responses. No **bold**, no *italic*, no `code`, no # headers, no --- dividers, no lists with * or -. Use plain text only. For lists, use • as a bullet.",
    "When you do use bullets, keep them compact and meaningful. Avoid repeating the user's prompt or your own role unless the user asked who you are.",
    "Prefer tool calls for wallet balances, portfolio inspection, Solscan explorer snapshots, account lookup, transaction explanation, token account inspection, program scans, recent signatures, and workspace file reads.",
    "Use web search for public facts or current documentation when on-chain data is not enough. Only trust the result if 3 to 5 references agree closely enough; otherwise say it is unverified and keep the answer grounded.",
    "For Solana ecosystem definitions, docs, releases, or other public factual questions, search first instead of answering from memory. Do not synthesize a fact unless the sources agree.",
    "Use the Solana snippet executor for small read-only JavaScript examples when code is easier than a direct RPC call. Keep snippets focused on learning, inspection, and validation.",
    "When displaying Solana program owners or accounts, prefer human-readable labels only when the source data provides them. Otherwise, show the raw address exactly as returned by the API and do not invent a label.",
    "Avoid informal wording like fake SOL. When you mean devnet funds, say test SOL or devnet SOL.",
    "When the user asks to inspect an address, present the result as clean terminal lines with a label and value separated by a colon. No boxes, no markdown, just clean factual lines.",
    "If the user asks to monitor something over time, revisit later, keep watching, or handle long-horizon work, create a durable background task or watch task yourself instead of asking the user to use a slash command.",
    "When the user is learning, explain Solana concepts only in the context of a real address, signature, token account, program, or DeFi workflow. Stay concise unless asked to go deeper.",
    "Do not ask the user to type a slash command when a tool can perform the action directly.",
    "Use durable tasks for asynchronous work and summarize clearly what was queued.",
    "Never pretend you executed shell commands or file writes. For those, ask the user to confirm via /run or /patch.",
    `Current network: ${session.state.network}`,
    `Current RPC: ${session.state.rpcUrl}`,
    `Current wallet: ${session.state.currentWallet || "none selected"}`,
    `Current strategy: ${session.state.currentStrategy}`,
    `Workspace: ${session.state.workspace}`,
    recent.length ? `Recent conversation:\n${recent.join("\n")}` : ""
  ].join(" ");
}

function buildPlanningPrompt(session) {
  const recent = (session.state.history || []).slice(-10).map((entry) => {
    const role = entry.role === "user" ? "User" : "Assistant";
    const limit = entry.role === "user" ? 400 : 600;
    return `${role}: ${String(entry.content || "").slice(0, limit)}`;
  });
  return [
    "You are ORION's planner for an agentic DeFi CLI for Solana learners and operators.",
    "Your job is to decide whether the user's prompt should be handled directly or decomposed into smaller tasks.",
    "The user will not see your internal planning JSON directly. Keep plans minimal and concrete.",
    "Always think in terms of substeps first.",
    "Prefer a small number of concrete steps that can each be executed independently.",
    "If the prompt is a simple direct question, return one step and mode \"answer\".",
    "If the prompt requires multiple inspections, comparisons, searches, or follow-up analysis, return multiple steps and mode \"task\".",
    "If the prompt asks to watch or monitor over time, return mode \"watch\" and a small set of steps for the initial setup and follow-up.",
    "If the prompt is a lookup for a specific Solana address or transaction signature, return mode \"lookup\" and a small 2-4 step plan.",
    "If the prompt needs public web facts, current documentation, or non-chain context, the final steps may include web search. Use only consistent references.",
    "If the prompt asks what a Solana term means or how the ecosystem works, prefer a search-backed answer over memory.",
    "Return strict JSON with keys: mode, title, summary, needsBackground, steps.",
    "Each step must be an object with keys: title, goal.",
    "No markdown. No code fences. No commentary outside JSON.",
    `Current network: ${session.state.network}`,
    `Current RPC: ${session.state.rpcUrl}`,
    `Current wallet: ${session.state.currentWallet || "none selected"}`,
    `Current strategy: ${session.state.currentStrategy}`,
    `Workspace: ${session.state.workspace}`,
    recent.length ? `Recent conversation:\n${recent.join("\n")}` : ""
  ].join(" ");
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function fallbackPlan(prompt) {
  const text = String(prompt).toLowerCase();
  const wantsWatch = [
    "watch",
    "monitor",
    "keep an eye",
    "keep checking",
    "track",
    "follow",
    "alert me",
    "notify me",
    "long horizon"
  ].some((phrase) => text.includes(phrase));

  const steps = [];
  if (wantsWatch) {
    steps.push(
      { title: "Identify the target", goal: "Extract the wallet, signature, program, or logs target and confirm it is valid." },
      { title: "Set up monitoring", goal: "Create the smallest useful watch or recurring check for that target." },
      { title: "Report findings", goal: "Explain what changed and what the user should know next." }
    );
    return {
      mode: "watch",
      title: "Long-running watch",
      summary: "Split the watch into setup, monitoring, and reporting steps.",
      needsBackground: true,
      steps
    };
  }

  const multiStepHints = [
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
    "explain what happened",
    "summarize what you found"
  ];
  const complex = multiStepHints.some((phrase) => text.includes(phrase)) || text.split(/\s+/).length > 16;
  if (complex) {
    steps.push(
      { title: "Clarify the target", goal: "Identify the address, signature, program, wallet, or DeFi topic the user wants to inspect." },
      { title: "Gather on-chain evidence", goal: "Use the best Solana tools available to inspect the live chain state and relevant history." },
      { title: "Synthesize the result", goal: "Summarize what changed, what matters, and what the user should do next." }
    );
    return {
      mode: "task",
      title: "Multi-step Solana investigation",
      summary: "Split the prompt into clarify, gather, and synthesize steps.",
      needsBackground: true,
      steps
    };
  }

  return {
    mode: "answer",
    title: "Direct answer",
    summary: "One step is sufficient, so answer directly after a light plan check.",
    needsBackground: false,
    steps: [
      {
        title: "Answer directly",
        goal: "Answer the user's question clearly using the current Solana context."
      }
    ]
  };
}

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage?.tool_calls?.length) {
    return "tools";
  }
  return END;
}

export class LangGraphHarness {
  constructor({ session, ollamaBaseUrl, model, toolRegistry, solana }) {
    this.session = session;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.model = model;
    this.toolRegistry = toolRegistry;
    this.solana = solana;
    this.memory = new MemorySaver();
  }

  async decomposePrompt(ctx, prompt) {
    // Structural pre-check: if heuristics already say "single answer", skip the LLM planner call
    const quick = fallbackPlan(prompt);
    if (quick.mode === "answer" && quick.steps.length === 1) {
      return quick;
    }

    const headers = config.ollamaApiKey
      ? { Authorization: `Bearer ${config.ollamaApiKey}` }
      : undefined;
    const model = new ChatOllama({
      baseUrl: this.ollamaBaseUrl,
      model: this.model,
      headers,
      temperature: 0.1
    });

    const response = await model.invoke([
      new SystemMessage(buildPlanningPrompt(this.session)),
      new HumanMessage(prompt)
    ]);

    this.session.recordTokenUsage?.(buildPlanningPrompt(this.session));

    const parsed = extractJsonObject(response.content);
    if (!parsed || typeof parsed !== "object") {
      return fallbackPlan(prompt);
    }

    const normalizedSteps = Array.isArray(parsed.steps)
      ? parsed.steps
          .filter(Boolean)
          .map((step, index) => ({
            title: String(step?.title || `Step ${index + 1}`),
            goal: String(step?.goal || step?.summary || step?.title || prompt)
          }))
      : [];

    if (!normalizedSteps.length) {
      return fallbackPlan(prompt);
    }

    const mode = ["answer", "lookup", "watch", "task"].includes(String(parsed.mode))
      ? String(parsed.mode)
      : normalizedSteps.length > 1 ? "task" : "answer";

    return {
      mode,
      title: String(parsed.title || normalizedSteps[0]?.title || "Planned task"),
      summary: String(parsed.summary || ""),
      needsBackground: Boolean(parsed.needsBackground) || mode === "task" || mode === "watch" || normalizedSteps.length > 1,
      steps: normalizedSteps
    };
  }

  createGraph(ctx, mode = "chat", { useTools = true } = {}) {
    const tools = useTools ? buildLangGraphTools(ctx) : [];
    const headers = config.ollamaApiKey
      ? { Authorization: `Bearer ${config.ollamaApiKey}` }
      : undefined;
    const model = new ChatOllama({
      baseUrl: this.ollamaBaseUrl,
      model: this.model,
      headers,
      temperature: mode === "task" ? 0.2 : 0.1
    });
    const boundModel = tools.length ? model.bindTools(tools) : model;

    const callModel = async (state) => {
      const response = await boundModel.invoke([
        new SystemMessage(buildSystemPrompt(this.session, mode)),
        ...state.messages
      ]);

      return {
        messages: [response]
      };
    };

    const builder = new StateGraph(MessagesAnnotation)
      .addNode("agent", callModel)
      .addEdge(START, "agent");

    if (tools.length) {
      builder.addNode("tools", new ToolNode(tools));
      builder.addConditionalEdges("agent", shouldContinue);
      builder.addEdge("tools", "agent");
    }

    return builder.compile({
      checkpointer: this.memory
    });
  }

  async runPrompt(ctx, prompt, options = {}) {
    const graph = this.createGraph(ctx, options.mode || "chat", { useTools: options.useTools !== false });
    const threadId = options.threadId || `orion-chat-${ctx.session.state.sessionId || "session"}`;
    const result = await graph.invoke(
      {
        messages: [new HumanMessage(prompt)]
      },
      {
        configurable: {
          thread_id: threadId,
          recursionLimit: options.recursionLimit || config.graphRecursionLimit
        },
        signal: options.signal
      }
    );

    const lastMessage = result.messages[result.messages.length - 1];
    this.session.recordTokenUsage?.(buildSystemPrompt(this.session, options.mode || "chat"));
    return lastMessage?.content || "No response returned by the graph.";
  }

  async runTask(ctx, prompt, options = {}) {
    const graph = this.createGraph(ctx, "task", { useTools: true });
    const threadId = options.threadId || `orion-task-${ctx.session.state.sessionId || "session"}`;
    const stream = await graph.stream(
      {
        messages: [new HumanMessage(prompt)]
      },
      {
        configurable: {
          thread_id: threadId,
          recursionLimit: options.recursionLimit || config.graphRecursionLimit
        },
        signal: options.signal
      },
      {
        streamMode: "updates"
      }
    );

    const updates = [];
    let lastAgentContent = null;

    for await (const chunk of stream) {
      updates.push(chunk);
      if (options.onUpdate) {
        await options.onUpdate(chunk);
      }
      if (chunk?.agent?.messages?.length) {
        const msgs = chunk.agent.messages;
        const last = msgs[msgs.length - 1];
        if (last?.content && typeof last.content === "string" && last.content.trim()) {
          lastAgentContent = last.content;
        }
      }
    }

    this.session.recordTokenUsage?.(buildSystemPrompt(this.session, "task"));

    return {
      updates,
      response: lastAgentContent || "No response returned by the graph."
    };
  }
}
