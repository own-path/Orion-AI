import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { runSolanaSnippet } from "./snippet-exec.js";

function defaultWallet(session, explicit) {
  return explicit || session.state.currentWallet || "";
}

export function buildLangGraphTools(ctx) {
  return [
    tool(
      async ({ address }) => {
        const target = defaultWallet(ctx.session, address);
        if (!target) {
          throw new Error("No wallet selected. Use /wallet create or /wallet select <address> first.");
        }
        const balance = await ctx.solana.getWalletBalance(target);
        return JSON.stringify(balance, null, 2);
      },
      {
        name: "get_wallet_balance",
        description: "Get the SOL balance for a wallet. Use the current selected wallet if no address is provided.",
        schema: z.object({
          address: z.string().optional().describe("Wallet address to inspect")
        })
      }
    ),
    tool(
      async ({ address }) => {
        const target = defaultWallet(ctx.session, address);
        if (!target) {
          throw new Error("No wallet selected. Use /wallet create or /wallet select <address> first.");
        }
        const portfolio = await ctx.solana.getPortfolioState(target, ctx.session.state.currentStrategy);
        return JSON.stringify(portfolio, null, 2);
      },
      {
        name: "get_portfolio",
        description: "Get a wallet portfolio summary including SOL balance, network, and max allocatable SOL.",
        schema: z.object({
          address: z.string().optional().describe("Wallet address to inspect")
        })
      }
    ),
    tool(
      async ({ address }) => {
        const account = await ctx.solana.getAccountInfo(address);
        if (!account) {
          return "Account not found.";
        }
        return JSON.stringify(account, null, 2);
      },
      {
        name: "inspect_account",
        description: "Inspect a Solana account and return owner, executable flag, lamports, and data length.",
        schema: z.object({
          address: z.string().describe("Solana account address")
        })
      }
    ),
    tool(
      async ({ address, limit }) => {
        const snapshot = await ctx.solana.getExplorerSnapshot(address, {
          limit: limit || 10
        });
        return JSON.stringify(snapshot, null, 2);
      },
      {
        name: "lookup_solana_explorer",
        description:
          "Fetch a Solscan-backed explorer snapshot for a Solana address, including account details, transaction history, transfers, and portfolio data when available.",
        schema: z.object({
          address: z.string().describe("Solana address to inspect"),
          limit: z.number().optional().describe("Maximum number of transactions or transfers to return")
        })
      }
    ),
    tool(
      async ({ method, params, commitment }) => {
        const result = await ctx.solana.callRpcMethod(method, params || [], {
          commitment: commitment || "confirmed"
        });
        return JSON.stringify(result, null, 2);
      },
      {
        name: "call_solana_rpc",
        description:
          "Call any Solana JSON-RPC method directly when a dedicated helper does not exist yet. Use this for the broader Connection/RPC surface.",
        schema: z.object({
          method: z.string().describe("JSON-RPC method name, for example getAccountInfo, getBalance, getBlock, simulateTransaction"),
          params: z.array(z.unknown()).optional().describe("Raw JSON-RPC positional params"),
          commitment: z.string().optional().describe("Optional commitment level such as confirmed or finalized")
        })
      }
    ),
    tool(
      async ({ signature }) => {
        const tx = await ctx.solana.getTransactionSummary(signature);
        if (!tx) {
          return "Transaction not found.";
        }
        return JSON.stringify(tx, null, 2);
      },
      {
        name: "explain_transaction",
        description: "Fetch and summarize a Solana transaction by signature.",
        schema: z.object({
          signature: z.string().describe("Transaction signature")
        })
      }
    ),
    tool(
      async ({ address, limit }) => {
        const target = defaultWallet(ctx.session, address);
        if (!target) {
          throw new Error("No wallet selected. Use /wallet create or /wallet select <address> first.");
        }
        const signatures = await ctx.solana.getRecentSignatures(target, limit);
        return JSON.stringify(signatures, null, 2);
      },
      {
        name: "get_recent_signatures",
        description: "Fetch recent signatures for a wallet or account, newest first.",
        schema: z.object({
          address: z.string().optional().describe("Wallet or account address"),
          limit: z.number().optional().describe("Maximum number of signatures to fetch")
        })
      }
    ),
    tool(
      async ({ programId, limit }) => {
        const accounts = await ctx.solana.getProgramAccounts(programId, { limit });
        return JSON.stringify(accounts, null, 2);
      },
      {
        name: "scan_program_accounts",
        description: "Fetch accounts owned by a program. Useful for protocol state scans.",
        schema: z.object({
          programId: z.string().describe("Solana program id"),
          limit: z.number().optional().describe("Maximum number of accounts to return")
        })
      }
    ),
    tool(
      async ({ addresses }) => {
        const fees = await ctx.solana.getRecentPrioritizationFees(addresses || []);
        return JSON.stringify(fees, null, 2);
      },
      {
        name: "get_recent_prioritization_fees",
        description: "Get recent prioritization fee samples for one or more addresses.",
        schema: z.object({
          addresses: z.array(z.string()).optional().describe("Addresses to scope fee estimation")
        })
      }
    ),
    tool(
      async ({ goal }) => {
        const task = await ctx.harness.queueTask(goal);
        return JSON.stringify(
          {
            queued: true,
            taskId: task.id,
            status: task.status,
            title: task.title
          },
          null,
          2
        );
      },
      {
        name: "queue_background_task",
        description:
          "Queue a durable long-running background task when the user asks Orion to monitor, research over time, revisit later, or handle multi-step work asynchronously.",
        schema: z.object({
          goal: z.string().describe("The long-running task goal to execute in the background")
        })
      }
    ),
    tool(
      async ({ watchType, target, goal }) => {
        const task = await ctx.harness.queueWatchTask({
          watchType,
          target,
          prompt: goal || ""
        });
        return JSON.stringify(
          {
            queued: true,
            taskId: task.id,
            watchType,
            target,
            status: task.status
          },
          null,
          2
        );
      },
      {
        name: "create_watch_task",
        description:
          "Create a durable Solana watch for account changes, signature confirmation, or logs when the user asks to monitor chain activity over time.",
        schema: z.object({
          watchType: z.enum(["account", "signature", "logs"]).describe("Type of Solana watch to create"),
          target: z.string().describe("Account address, transaction signature, or program/log target"),
          goal: z.string().optional().describe("Optional follow-up analysis goal for each event")
        })
      }
    ),
    tool(
      async () => {
        const tasks = await ctx.harness.listTasks();
        return JSON.stringify(
          tasks.slice(0, 20).map((task) => ({
            id: task.id,
            type: task.type,
            watchType: task.watchType || null,
            status: task.status,
            title: task.title || null,
            target: task.target || null
          })),
          null,
          2
        );
      },
      {
        name: "list_durable_tasks",
        description: "List existing durable background tasks and watch jobs.",
        schema: z.object({})
      }
    ),
    tool(
      async ({ file }) => {
        const result = await ctx.toolRegistry.get("workspace.read").execute(ctx, { file });
        return (result.lines || []).join("\n");
      },
      {
        name: "read_workspace_file",
        description: "Read a text file from the current workspace. Use this for repo-aware tasks.",
        schema: z.object({
          file: z.string().describe("Relative path to the file")
        })
      }
    ),
    tool(
      async ({ command }) => {
        return JSON.stringify(
          {
            denied: true,
            reason: "Shell execution requires explicit user confirmation. Ask the user to use /run instead."
          },
          null,
          2
        );
      },
      {
        name: "request_shell_command",
        description: "Request a shell command when needed. This tool does not execute automatically and will instruct the user to confirm via /run.",
        schema: z.object({
          command: z.string().describe("Shell command the agent wants to run")
        })
      }
    ),
    tool(
      async ({ code }) => {
        const result = await runSolanaSnippet(ctx, code, { label: "langgraph-snippet" });
        return JSON.stringify(result, null, 2);
      },
      {
        name: "execute_solana_code",
        description:
          "Execute a small Solana JavaScript snippet with Orion's current context. Use this for examples, validation, or exploratory code that benefits from live chain state.",
        schema: z.object({
          code: z.string().describe("JavaScript code to run in Orion's Solana execution sandbox")
        })
      }
    ),
    tool(
      async ({ file, instruction }) => {
        return JSON.stringify(
          {
            denied: true,
            reason: "File modifications require patch preview and confirmation. Ask the user to use /patch.",
            file,
            instruction
          },
          null,
          2
        );
      },
      {
        name: "request_file_patch",
        description: "Request a file modification. This tool does not write automatically; it tells the user to use /patch for preview and approval.",
        schema: z.object({
          file: z.string().describe("Relative path to modify"),
          instruction: z.string().describe("Desired file change")
        })
      }
    ),
    tool(
      async ({ dir }) => {
        return JSON.stringify(
          {
            denied: true,
            reason: "Rust client scaffolding writes files and requires explicit confirmation. Ask the user to use /rust-client.",
            dir
          },
          null,
          2
        );
      },
      {
        name: "request_rust_client_scaffold",
        description:
          "Request scaffolding for an official Solana Rust client. This tool does not write automatically; it instructs the user to confirm via /rust-client.",
        schema: z.object({
          dir: z.string().describe("Target directory for the Rust client scaffold")
        })
      }
    )
  ];
}
