import fs from "node:fs/promises";
import path from "node:path";
import { buildPatchPreview } from "./diff-preview.js";
import { confirmAction, assertNonMainnet } from "./permissions.js";
import { runSolanaSnippet } from "./snippet-exec.js";
import { searchWeb } from "./web-search.js";

function createTool(id, description, execute) {
  return { id, description, execute };
}

export function buildToolRegistry() {
  const tools = [
    createTool("wallet.create", "Generate a new wallet and select it", async ({ session, solana }) => {
      const wallet = await solana.createWallet();
      await session.setGeneratedWallet(wallet);
      return {
        type: "panel",
        title: "Wallet Created",
        lines: [`Public Key: ${wallet.publicKey}`, "Secret key saved in local CLI session state only."]
      };
    }),
    createTool("wallet.balance", "Inspect SOL balance for a wallet", async ({ solana }, { address }) => {
      const balance = await solana.getWalletBalance(address);
      return {
        type: "panel",
        title: "Wallet Balance",
        lines: [`Address: ${balance.walletAddress}`, `Network: ${balance.network}`, `SOL: ${balance.solBalance.toFixed(6)}`]
      };
    }),
    createTool("wallet.portfolio", "Summarize wallet portfolio state", async ({ solana, session }, { address }) => {
      const portfolio = await solana.getPortfolioState(address, session.state.currentStrategy);
      return {
        type: "panel",
        title: "Portfolio",
        lines: [
          `Wallet: ${portfolio.walletAddress}`,
          `Network: ${portfolio.network}`,
          `SOL: ${portfolio.solBalance.toFixed(6)}`,
          `USD Estimate: $${portfolio.estimatedUsdValue.toFixed(2)}`,
          `Max Allocatable SOL: ${portfolio.maxAllocatableSol.toFixed(4)}`
        ]
      };
    }),
    createTool("solana.account", "Inspect a Solana account", async ({ solana }, { address }) => {
      const account = await solana.getAccountInfo(address);
      if (!account) {
        return { type: "text", text: "Account not found." };
      }
      return {
        type: "panel",
        title: "Account",
        lines: [
          `Address: ${account.address}`,
          `Owner: ${account.owner}`,
          `Executable: ${account.executable}`,
          `Lamports: ${account.lamports}`,
          `Data Length: ${account.dataLength}`
        ]
      };
    }),
    createTool("solana.tx", "Explain a transaction by signature", async ({ solana }, { signature }) => {
      const tx = await solana.getTransactionSummary(signature);
      if (!tx) {
        return { type: "text", text: "Transaction not found." };
      }
      return {
        type: "panel",
        title: "Transaction",
        lines: [
          `Signature: ${tx.signature}`,
          `Status: ${tx.status}`,
          `Slot: ${tx.slot}`,
          `Block Time: ${tx.blockTime || "n/a"}`,
          `Fee SOL: ${tx.feeSol}`,
          `Instruction Count: ${tx.instructionCount}`,
          `Accounts: ${tx.accounts.length}`
        ]
      };
    }),
    createTool("solana.signatures", "Fetch recent signatures for an address", async ({ solana }, { address, limit }) => {
      const signatures = await solana.getRecentSignatures(address, limit);
      return {
        type: "panel",
        title: "Recent Signatures",
        lines: signatures.length
          ? signatures.map(
              (entry) =>
                `${entry.signature} | slot ${entry.slot} | ${entry.confirmationStatus || "unknown"} | ${entry.blockTime || "n/a"}`
            )
          : ["No signatures found."]
      };
    }),
    createTool("solana.program", "Fetch accounts owned by a program", async ({ solana }, { programId, limit }) => {
      const accounts = await solana.getProgramAccounts(programId, { limit });
      return {
        type: "panel",
        title: "Program Accounts",
        lines: accounts.length
          ? accounts.map((account) => `${account.pubkey} | owner ${account.owner} | lamports ${account.lamports}`)
          : ["No accounts found."]
      };
    }),
    createTool("solana.fees", "Inspect recent prioritization fees", async ({ solana }, { addresses }) => {
      const fees = await solana.getRecentPrioritizationFees(addresses || []);
      return {
        type: "panel",
        title: "Prioritization Fees",
        lines: fees.length
          ? fees.slice(0, 10).map((entry) => `slot ${entry.slot} | fee ${entry.prioritizationFee}`)
          : ["No fee samples returned."]
      };
    }),
    createTool("web.search", "Search the public web with consensus filtering", async (_, { query, limit }) => {
      const result = await searchWeb(query, { limit });
      return {
        type: "panel",
        title: result.consensus?.consensus ? "Web Search Consensus" : "Web Search Results",
        lines: [
          `Query: ${result.query}`,
          `Consensus: ${result.consensus?.consensus ? "yes" : "no"}`,
          `Confidence: ${result.consensus?.confidence ?? 0}`,
          result.consensus?.sharedTerms?.length ? `Shared Terms: ${result.consensus.sharedTerms.join(", ")}` : "Shared Terms: none",
          "",
          ...(result.results || []).map((entry, index) => `${index + 1}. ${entry.title} | ${entry.url} | ${entry.snippet}`)
        ]
      };
    }),
    createTool("solana.airdrop", "Request a devnet or testnet airdrop", async ({ session, solana }, { address, solAmount }) => {
      assertNonMainnet(session, "Airdrop");
      const result = await solana.requestAirdrop(address, solAmount);
      return {
        type: "panel",
        title: "Airdrop",
        lines: [
          `Wallet: ${result.walletAddress}`,
          `Amount: ${result.solAmount} SOL`,
          `Signature: ${result.signature}`,
          `Network: ${result.network}`
        ]
      };
    }),
    createTool("workspace.read", "Read a workspace file", async ({ session }, { file }) => {
      const filePath = path.resolve(session.state.workspace, file);
      const content = await fs.readFile(filePath, "utf8");
      return {
        type: "panel",
        title: filePath,
        lines: content.split("\n").slice(0, 200)
      };
    }),
    createTool("workspace.run", "Run a shell command with confirmation", async ({ rl, session }, { command, shell }) => {
      if (!(await confirmAction(rl, `Run shell command: ${command}?`))) {
        return { type: "text", text: "Command cancelled." };
      }

      const result = await shell(command, session.state.workspace);
      return {
        type: "panel",
        title: "Command Result",
        lines: [`Exit Code: ${result.code}`, result.stdout || "(no stdout)", result.stderr ? `stderr:\n${result.stderr}` : ""].filter(Boolean)
      };
    }),
    createTool("workspace.patch", "Rewrite a file with diff preview and explicit apply", async ({ rl, ollama, session }, { file, instruction }) => {
      const filePath = path.resolve(session.state.workspace, file);
      const currentContent = await fs.readFile(filePath, "utf8");
      const rewrite = await ollama.rewriteFile({
        filePath,
        currentContent,
        instruction,
        model: session.state.model,
        workspaceContext: {
          workspace: session.state.workspace,
          strategy: session.state.currentStrategy,
          wallet: session.state.currentWallet
        }
      });
      const patch = await buildPatchPreview(filePath, currentContent, rewrite.content);
      const approved = await confirmAction(rl, `Apply changes to ${filePath}?`);
      if (approved) {
        await fs.writeFile(filePath, rewrite.content, "utf8");
      }
      return {
        type: "patch",
        patch,
        summary: rewrite.summary || "No summary.",
        applied: approved
      };
    }),
    createTool("workspace.rust-client", "Scaffold an official Solana Rust client workspace", async ({ rl, session }, { dir }) => {
      const targetDir = path.resolve(session.state.workspace, dir);
      if (!(await confirmAction(rl, `Create Solana Rust client scaffold in ${targetDir}?`))) {
        return { type: "text", text: "Rust scaffold cancelled." };
      }

      await fs.mkdir(path.join(targetDir, "src"), { recursive: true });
      const cargoToml = `[package]
name = "orion-solana-rust-client"
version = "0.1.0"
edition = "2021"

[dependencies]
solana-client = "3"
solana-sdk = "3"
solana-commitment-config = "3"
anyhow = "1"
`;

      const mainRs = `use anyhow::Result;
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

fn main() -> Result<()> {
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let address = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "Vote111111111111111111111111111111111111111".to_string());

    let client = RpcClient::new_with_commitment(rpc_url.clone(), CommitmentConfig::confirmed());
    let pubkey = Pubkey::from_str(&address)?;
    let balance = client.get_balance(&pubkey)?;

    println!("rpc: {rpc_url}");
    println!("address: {address}");
    println!("lamports: {balance}");
    Ok(())
}
`;

      await fs.writeFile(path.join(targetDir, "Cargo.toml"), cargoToml, "utf8");
      await fs.writeFile(path.join(targetDir, "src/main.rs"), mainRs, "utf8");

      return {
        type: "panel",
        title: "Rust Client Scaffolded",
        lines: [
          `Directory: ${targetDir}`,
          "Crates: solana-client, solana-sdk, solana-commitment-config",
          "Run with: cargo run -- <pubkey>"
        ]
      };
    }),
    createTool("workspace.exec-snippet", "Run a read-only Solana JS snippet in Orion's context", async (ctx, { code, label }) => {
      const { rl } = ctx;
      if (!(await confirmAction(rl, "Run a Solana JS snippet in Orion's execution sandbox?"))) {
        return { type: "text", text: "Snippet cancelled." };
      }
      const result = await runSolanaSnippet(ctx, code, {
        label: label || "workspace-snippet"
      });
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
          result.ok ? String(result.result) : String(result.error)
        ]
      };
    }),
    createTool("voice.speak", "Generate local ElevenLabs speech output", async ({ voice }, { text }) => {
      const audio = await voice.generateSpeechToFile({
        text,
        filePrefix: "orion-cli"
      });
      return {
        type: "panel",
        title: "Voice Output",
        lines: [`File: ${audio.filePath}`, `Type: ${audio.contentType}`]
      };
    })
  ];

  return new Map(tools.map((tool) => [tool.id, tool]));
}
