import fs from "node:fs/promises";
import path from "node:path";
import { getStrategyConfig, normalizeStrategy, STRATEGIES } from "../../services/shared/strategies.js";
import { readSnippetFromRl, runSolanaSnippet } from "./snippet-exec.js";

function command(name, summary, usage, execute, options = {}) {
  return { name, summary, usage, execute, hidden: Boolean(options.hidden) };
}

function clusterPreset(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized === "devnet") {
    return { rpcUrl: "https://api.devnet.solana.com", network: "devnet" };
  }
  if (normalized === "testnet") {
    return { rpcUrl: "https://api.testnet.solana.com", network: "testnet" };
  }
  if (normalized === "mainnet" || normalized === "mainnet-beta") {
    return { rpcUrl: "https://api.mainnet-beta.solana.com", network: "mainnet-beta" };
  }
  return null;
}

function compactTask(task) {
  return `${task.id.slice(0, 8)} | ${task.type}${task.watchType ? `/${task.watchType}` : ""} | ${task.status} | ${task.title || task.target || "untitled"}`;
}

function truncate(value, max = 24_000) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

function buildExecTemplates() {
  return [
    {
      name: "wallet",
      summary: "Inspect the selected wallet with balance, account, and recent signatures",
      code: [
        "const walletAddress = wallet || session.wallet;",
        "if (!walletAddress) throw new Error('No wallet selected.');",
        "const [balance, account, signatures] = await Promise.all([",
        "  solana.getWalletBalanceAcrossClusters(walletAddress),",
        "  solana.getAccountInfoAcrossClusters(walletAddress),",
        "  solana.getRecentSignaturesAcrossClusters(walletAddress, 5)",
        "]);",
        "console.log(JSON.stringify({ walletAddress, balance, account, signatures }, null, 2));",
        "return { walletAddress, balance, account, signatures };"
      ].join("\n")
    },
    {
      name: "token-account",
      summary: "Inspect token accounts for a wallet with raw RPC",
      code: [
        "const walletAddress = wallet || session.wallet;",
        "if (!walletAddress) throw new Error('No wallet selected.');",
        "const tokenAccounts = await solana.callRpcMethod('getTokenAccountsByOwner', [",
        "  walletAddress,",
        "  { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },",
        "  { encoding: 'jsonParsed' }",
        "], { commitment: 'confirmed' });",
        "console.log(JSON.stringify(tokenAccounts, null, 2));",
        "return tokenAccounts;"
      ].join("\n")
    },
    {
      name: "compare-clusters",
      summary: "Compare the selected wallet across devnet and mainnet-beta",
      code: [
        "const walletAddress = wallet || session.wallet;",
        "if (!walletAddress) throw new Error('No wallet selected.');",
        "const current = await solana.getWalletBalanceAcrossClusters(walletAddress);",
        "const mainnet = await solana.callRpcMethod('getBalance', [walletAddress], { commitment: 'confirmed' }).catch(() => null);",
        "console.log(JSON.stringify({ walletAddress, current, mainnet }, null, 2));",
        "return { walletAddress, current, mainnet };"
      ].join("\n")
    },
    {
      name: "signatures",
      summary: "Dump recent signatures for the selected wallet or a provided address",
      code: [
        "const target = wallet || session.wallet;",
        "if (!target) throw new Error('No wallet selected.');",
        "const signatures = await solana.getRecentSignaturesAcrossClusters(target, 10);",
        "console.log(JSON.stringify(signatures, null, 2));",
        "return signatures;"
      ].join("\n")
    }
  ];
}

export function buildCommandRegistry(toolRegistry) {
  const runTool = async (ctx, id, params) => {
    const tool = toolRegistry.get(id);
    if (!tool) {
      throw new Error(`Unknown tool: ${id}`);
    }
    return tool.execute(ctx, params);
  };

  const commands = [
    command("help", "show command index", "/help", async ({ commandRegistry }) => ({
      type: "panel",
      title: "Commands",
      lines: Array.from(commandRegistry.values())
        .filter((entry) => !entry.hidden)
        .map((entry) => `${entry.usage.padEnd(36)} ${entry.summary}`)
    })),
    command("setup", "rerun first-launch onboarding", "/setup", async ({ harness }) => {
      await harness.runOnboarding();
      return null;
    }),
    command("status", "show current operator session", "/status", async ({ session, taskStore }) => {
      const tasks = await taskStore.list();
      return {
        type: "panel",
        title: "Session",
        lines: [
          `Workspace: ${session.state.workspace}`,
          `RPC: ${session.state.rpcUrl}`,
          `Network: ${session.state.network}`,
          `Wallet: ${session.state.currentWallet || "none"}`,
          `Strategy: ${session.state.currentStrategy}`,
          `Model: ${session.state.model || "default"}`,
          `Queued Tasks: ${tasks.filter((task) => task.status === "queued").length}`,
          `Active Watches: ${tasks.filter((task) => task.type === "watch" && task.status !== "cancelled").length}`
        ]
      };
    }),
    command("tools", "show available harness tools", "/tools", async ({ toolRegistry }) => ({
      type: "panel",
      title: "Tools",
      lines: Array.from(toolRegistry.values()).map((tool) => `${tool.id}  ${tool.description}`)
    }), { hidden: true }),
    command("models", "list local ollama models", "/models", async ({ ollama }) => {
      const models = await ollama.listModels();
      return {
        type: "panel",
        title: "Ollama Models",
        lines: models.length ? models : ["No local models found or Ollama is offline."]
      };
    }, { hidden: true }),
    command("model", "switch session model", "/model [name]", async ({ session }, args) => {
      if (!args[0]) {
        return { type: "text", text: `Current model: ${session.state.model || "default"}` };
      }
      await session.setModel(args[0]);
      return { type: "text", text: `Model set to ${args[0]}` };
    }, { hidden: true }),
    command("cluster", "switch common solana clusters", "/cluster [devnet|testnet|mainnet]", async ({ session }, args) => {
      if (!args[0]) {
        return { type: "text", text: `Current cluster: ${session.state.network}` };
      }
      const preset = clusterPreset(args[0]);
      if (!preset) {
        return { type: "text", text: "Unknown cluster. Use devnet, testnet, or mainnet." };
      }
      await session.setRpc(preset);
      return { type: "text", text: `Cluster set to ${preset.network} (${preset.rpcUrl})` };
    }, { hidden: true }),
    command("rpc", "inspect and call raw solana rpc", "/rpc info|set|call|methods", async (ctx, args) => {
      const [subcommand, ...rest] = args;
      if (!subcommand || subcommand === "info") {
        return {
          type: "panel",
          title: "RPC Inspector",
          lines: [
            `Current RPC: ${ctx.session.state.rpcUrl}`,
            `Current Network: ${ctx.session.state.network}`,
            "",
            "Commands:",
            "  /rpc methods",
            "  /rpc call <method> [json params]",
            "  /rpc set <url>",
            "",
            "Examples:",
            "  /rpc call getBalance [\"<pubkey>\"]",
            "  /rpc call getAccountInfo [\"<pubkey>\", {\"encoding\":\"jsonParsed\"}]",
            "  /rpc call getSignaturesForAddress [\"<pubkey>\", {\"limit\":5}]"
          ]
        };
      }

      if (subcommand === "methods") {
        return {
          type: "panel",
          title: "Common RPC Methods",
          lines: [
            "getBalance",
            "getAccountInfo",
            "getSignaturesForAddress",
            "getTransaction",
            "getProgramAccounts",
            "getRecentPrioritizationFees",
            "getBlock",
            "getLatestBlockhash",
            "simulateTransaction",
            "sendTransaction"
          ]
        };
      }

      if (subcommand === "set") {
        const url = rest[0];
        if (!url) {
          return { type: "text", text: "Usage: /rpc set <url>" };
        }
        await ctx.session.setRpc({ rpcUrl: url, network: ctx.session.state.network });
        return { type: "text", text: `RPC set to ${ctx.session.state.rpcUrl}` };
      }

      if (subcommand === "call") {
        const method = rest[0];
        if (!method) {
          return { type: "text", text: "Usage: /rpc call <method> [json params]" };
        }
        const raw = rest.slice(1).join(" ");
        let params = [];
        if (raw) {
          try {
            params = JSON.parse(raw);
            if (!Array.isArray(params)) {
              params = [params];
            }
          } catch {
            return { type: "text", text: "Could not parse JSON params. Pass a JSON array or object." };
          }
        }
        const result = await ctx.solana.callRpcMethod(method, params, { commitment: "confirmed" });
        return {
          type: "panel",
          title: `RPC ${method}`,
          lines: [JSON.stringify(result, null, 2)]
        };
      }

      return { type: "text", text: "Usage: /rpc info|set|call|methods" };
    }),
    command("strategy", "set execution strategy", "/strategy [conservative|balanced|aggressive]", async ({ session }, args) => {
      if (!args[0]) {
        return { type: "text", text: `Current strategy: ${session.state.currentStrategy}` };
      }
      const strategy = normalizeStrategy(args[0]);
      if (!strategy) {
        return { type: "text", text: `Unknown strategy. Choose one of: ${Object.keys(STRATEGIES).join(", ")}` };
      }
      await session.setStrategy(strategy);
      const config = getStrategyConfig(strategy);
      return {
        type: "text",
        text: `Strategy set to ${strategy}. Allocation ${Math.round(config.allocationPct * 100)}%, risk ${config.riskTolerance}.`
      };
    }, { hidden: true }),
    command("wallet", "create/select/balance wallet", "/wallet create|select|balance ...", async (ctx, args) => {
      if (args[0] === "create") {
        return runTool(ctx, "wallet.create", {});
      }
      if (args[0] === "select") {
        if (!args[1]) {
          return { type: "text", text: "Usage: /wallet select <address>" };
        }
        await ctx.session.setWallet(args[1]);
        return { type: "text", text: `Wallet selected: ${ctx.session.state.currentWallet}` };
      }
      if (args[0] === "balance") {
        const address = args[1] || ctx.session.state.currentWallet;
        if (!address) {
          throw new Error("No wallet selected. Use /wallet create or /wallet select <address>.");
        }
        return runTool(ctx, "wallet.balance", { address });
      }
      return { type: "text", text: "Usage: /wallet create | /wallet select <address> | /wallet balance [address]" };
    }, { hidden: true }),
    command("airdrop", "request devnet/testnet airdrop", "/airdrop [sol] [address]", async (ctx, args) => {
      const address = args[1] || ctx.session.state.currentWallet;
      if (!address) {
        throw new Error("No wallet selected. Use /wallet create or /wallet select <address>.");
      }
      return runTool(ctx, "solana.airdrop", {
        address,
        solAmount: Number(args[0] || 1)
      });
    }, { hidden: true }),
    command("portfolio", "show wallet portfolio", "/portfolio [address]", async (ctx, args) => {
      const address = args[0] || ctx.session.state.currentWallet;
      if (!address) {
        throw new Error("No wallet selected. Use /wallet create or /wallet select <address>.");
      }
      return runTool(ctx, "wallet.portfolio", { address });
    }, { hidden: true }),
    command("account", "inspect a solana account", "/account <address>", async (ctx, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /account <address>" };
      }
      return runTool(ctx, "solana.account", { address: args[0] });
    }, { hidden: true }),
    command("tx", "explain a transaction", "/tx <signature>", async (ctx, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /tx <signature>" };
      }
      return runTool(ctx, "solana.tx", { signature: args[0] });
    }, { hidden: true }),
    command("sigs", "show recent signatures for an address", "/sigs <address> [limit]", async (ctx, args) => {
      const address = args[0] || ctx.session.state.currentWallet;
      if (!address) {
        return { type: "text", text: "Usage: /sigs <address> [limit]" };
      }
      return runTool(ctx, "solana.signatures", { address, limit: Number(args[1] || 10) });
    }, { hidden: true }),
    command("program", "scan accounts owned by a program", "/program <programId> [limit]", async (ctx, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /program <programId> [limit]" };
      }
      return runTool(ctx, "solana.program", { programId: args[0], limit: Number(args[1] || 10) });
    }, { hidden: true }),
    command("fees", "inspect recent prioritization fees", "/fees [address...]", async (ctx, args) =>
      runTool(ctx, "solana.fees", { addresses: args })
    , { hidden: true }),
    command("read", "read a workspace file", "/read <path>", async (ctx, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /read <path>" };
      }
      return runTool(ctx, "workspace.read", { file: args[0] });
    }, { hidden: true }),
    command("rust-client", "scaffold an official Solana Rust client", "/rust-client [dir]", async (ctx, args) =>
      runTool(ctx, "workspace.rust-client", { dir: args[0] || "solana-rust-client" })
    , { hidden: true }),
    command("run", "run a shell command with confirmation", "/run <shell command>", async (ctx, args) => {
      const commandText = args.join(" ");
      if (!commandText) {
        return { type: "text", text: "Usage: /run <shell command>" };
      }
      return runTool(ctx, "workspace.run", { command: commandText, shell: ctx.shell });
    }, { hidden: true }),
    command("tasks", "list durable tasks", "/tasks", async ({ harness }) => {
      const tasks = await harness.listTasks();
      return {
        type: "panel",
        title: "Tasks",
        lines: tasks.length ? tasks.map(compactTask) : ["No tasks yet."]
      };
    }),
    command("task-status", "show one task in detail", "/task-status <taskId>", async ({ harness }, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /task-status <taskId>" };
      }
      const task = await harness.getTask(args[0]);
      if (!task) {
        return { type: "text", text: "Task not found." };
      }
      return {
        type: "panel",
        title: `Task ${task.id.slice(0, 8)}`,
        lines: [
          `Type: ${task.type}${task.watchType ? `/${task.watchType}` : ""}`,
          `Status: ${task.status}`,
          `Title: ${task.title || "n/a"}`,
          `Prompt: ${task.prompt || "n/a"}`,
          `Target: ${task.target || "n/a"}`,
          `Events: ${task.eventCount || 0}`,
          `Last Summary: ${task.resultSummary || task.lastEventSummary || "n/a"}`,
          `Last Error: ${task.lastError || "n/a"}`
        ]
      };
    }),
    command("resume", "resume a queued/cancelled task", "/resume <taskId>", async ({ harness }, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /resume <taskId>" };
      }
      const task = await harness.resumeTask(args[0]);
      return { type: "text", text: `Task ${task.id.slice(0, 8)} resumed as ${task.status}.` };
    }),
    command("cancel", "cancel a task or watch", "/cancel <taskId>", async ({ harness }, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /cancel <taskId>" };
      }
      const task = await harness.cancelTask(args[0]);
      return { type: "text", text: `Task ${task.id.slice(0, 8)} cancelled.` };
    }),
    command("patch", "preview and optionally apply a file rewrite", "/patch <file>", async (ctx, args) => {
      if (!args[0]) {
        return { type: "text", text: "Usage: /patch <file>" };
      }
      const instruction = await ctx.rl.question("Edit instruction: ");
      return runTool(ctx, "workspace.patch", { file: args[0], instruction });
    }, { hidden: true }),
    command("exec-templates", "show canned Solana code-execution templates", "/exec templates", async () => ({
      type: "panel",
      title: "Exec Templates",
      lines: buildExecTemplates().flatMap((template) => [
        `${template.name.padEnd(20)} ${template.summary}`,
        `  /exec template ${template.name}`
      ])
    }), { hidden: true }),
    command("exec", "run a Solana JS snippet in Orion's context", "/exec [js|file] ...", async (ctx, args) => {
      const [subcommand, ...rest] = args;
      let code = "";
      let label = "solana-snippet";

      if (subcommand === "templates") {
        return {
          type: "panel",
          title: "Exec Templates",
          lines: buildExecTemplates().flatMap((template) => [
            `${template.name.padEnd(20)} ${template.summary}`,
            `  /exec template ${template.name}`
          ])
        };
      }

      if (subcommand === "template") {
        const templateName = rest[0];
        if (!templateName) {
          return { type: "text", text: "Usage: /exec template <name>" };
        }
        const template = buildExecTemplates().find((entry) => entry.name === templateName);
        if (!template) {
          return { type: "text", text: `Unknown template: ${templateName}. Use /exec templates.` };
        }
        code = template.code;
        label = `template-${templateName}`;
      } else if (!subcommand || subcommand === "js") {
        const inline = rest.join(" ").trim();
        code = inline || await readSnippetFromRl(ctx.rl);
        label = inline ? "inline-js" : "pasted-js";
      } else if (subcommand === "file") {
        const file = rest[0];
        if (!file) {
          return { type: "text", text: "Usage: /exec file <path>" };
        }
        const filePath = path.resolve(ctx.session.state.workspace, file);
        code = await fs.readFile(filePath, "utf8");
        label = file;
      } else {
        code = [subcommand, ...rest].join(" ").trim();
        label = "inline-js";
      }

      if (!code.trim()) {
        return { type: "text", text: "No JavaScript was provided." };
      }

      const result = await runSolanaSnippet(ctx, code, { label });
      return {
        type: "panel",
        title: result.ok ? "Solana JS Execution" : "Solana JS Execution Failed",
        lines: [
          `Status: ${result.ok ? "ok" : "error"}`,
          `Elapsed: ${result.elapsedMs}ms`,
          "",
          "Stdout:",
          ...(result.stdout.length ? result.stdout : ["(no stdout)"]),
          "",
          result.ok ? "Result:" : "Error:",
          truncate(result.ok ? result.result : result.error)
        ]
      };
    }),
    command("voice", "generate voice output", "/voice <text>", async (ctx, args) => {
      const text = args.join(" ");
      if (!text) {
        return { type: "text", text: "Usage: /voice <text>" };
      }
      return runTool(ctx, "voice.speak", { text });
    }, { hidden: true }),
    command("history", "show session transcript", "/history", async ({ session }) => ({
      type: "panel",
      title: "History",
      lines: session.state.history.length
        ? session.state.history.map((entry) => `${entry.at} | ${entry.role}: ${entry.content}`)
        : ["No session history yet."]
    }), { hidden: true }),
    command("clear", "clear session transcript", "/clear", async ({ session }) => {
      session.clearHistory();
      await session.save();
      return { type: "text", text: "Session history cleared." };
    }, { hidden: true }),
    command("exit", "exit the cli", "/exit", async () => ({ type: "exit" })),
    command(
      "task-debug",
      "show the durable task surface",
      "/task-debug",
      async ({ harness }) => {
        const tasks = await harness.listTasks();
        return {
          type: "panel",
          title: "Task Debug",
          lines: tasks.length ? tasks.map(compactTask) : ["No tasks yet."]
        };
      },
      { hidden: true }
    )
  ];

  return new Map(commands.map((entry) => [entry.name, entry]));
}
