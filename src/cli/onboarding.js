import { getStrategyConfig, STRATEGIES } from "../../services/shared/strategies.js";
import { printPanel, printSummary } from "./renderer.js";
import { accent, info, muted, success, warn } from "./theme.js";

const CLUSTERS = [
  {
    key: "devnet",
    label: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    note: "best for testing wallets, airdrops, and harness flows"
  },
  {
    key: "testnet",
    label: "testnet",
    rpcUrl: "https://api.testnet.solana.com",
    note: "validator-style testing, fewer app integrations"
  },
  {
    key: "mainnet-beta",
    label: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    note: "real chain, no airdrops, use with care"
  }
];

function normalizeChoice(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function promptChoice(rl, title, rows, options, fallbackIndex = 0) {
  printPanel(
    title,
    rows.concat([
      "",
      ...options.map((option, index) => `${index + 1}. ${option.label}${option.note ? `  ${muted(option.note)}` : ""}`)
    ])
  );

  const answer = normalizeChoice(await rl.question(accent("Select option") + ` [${fallbackIndex + 1}]: `));
  if (!answer) {
    return options[fallbackIndex];
  }

  const byIndex = Number(answer);
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= options.length) {
    return options[byIndex - 1];
  }

  return options.find((option) => normalizeChoice(option.key || option.label) === answer) || options[fallbackIndex];
}

export async function runOnboarding(ctx) {
  const { rl, ollama, session, solana } = ctx;
  const localModels = await ollama.listModels();
  const modelOptions = [
    ...localModels.map((name) => ({
      key: name,
      label: name,
      note: "installed in local Ollama"
    })),
    {
      key: "custom",
      label: "custom model",
      note: "enter a different local model name"
    }
  ];

  printPanel("Welcome", [
    success("ORION is now configured as an agentic DeFi CLI for Solana."),
    "This setup runs once on first launch and can be rerun with /setup.",
    "",
    `${info("Harness")}: LangGraph orchestration, tool calling, long-running task mode`,
    `${info("Model backend")}: local Ollama`,
    `${info("Safety")}: shell commands and file writes always require confirmation`
  ]);
  await rl.question(accent("Press Enter to continue "));

  const modelSelection = await promptChoice(
    rl,
    "Step 1 · Default Model",
    [
      "Choose the default Ollama model for normal turns and long-running graph tasks.",
      localModels.length ? `Detected ${localModels.length} local model(s).` : warn("No running Ollama models detected right now.")
    ],
    modelOptions,
    0
  );

  const selectedModel =
    modelSelection.key === "custom"
      ? (await rl.question(accent("Enter Ollama model name: "))).trim() || session.state.model
      : modelSelection.key;
  await session.setModel(selectedModel);

  const clusterSelection = await promptChoice(
    rl,
    "Step 2 · Solana Cluster",
    ["Pick the default network Orion should use for wallet inspection and RPC actions."],
    CLUSTERS.map((cluster) => ({
      ...cluster,
      key: cluster.key
    })),
    Math.max(
      0,
      CLUSTERS.findIndex((cluster) => cluster.key === session.state.network)
    )
  );
  await session.setRpc({
    rpcUrl: clusterSelection.rpcUrl,
    network: clusterSelection.key
  });
  solana.setRpcUrl(clusterSelection.rpcUrl, clusterSelection.key);

  const strategyKeys = Object.keys(STRATEGIES);
  const strategySelection = await promptChoice(
    rl,
    "Step 3 · Operator Strategy",
    ["Set the default posture Orion should assume when reasoning about Solana actions."],
    strategyKeys.map((key) => {
      const strategy = getStrategyConfig(key);
      return {
        key,
        label: key,
        note: `allocation ${Math.round(strategy.allocationPct * 100)}% · risk ${strategy.riskTolerance}`
      };
    }),
    Math.max(0, strategyKeys.indexOf(session.state.currentStrategy))
  );
  await session.setStrategy(strategySelection.key);

  const walletSelection = await promptChoice(
    rl,
    "Step 4 · Wallet Context",
    ["Choose how Orion should start with wallet context."],
    [
      { key: "skip", label: "skip for now", note: "start without a selected wallet" },
      { key: "create", label: "create wallet", note: "generate and select a new local wallet" },
      { key: "select", label: "select existing", note: "paste a wallet address to use" }
    ],
    session.state.currentWallet ? 2 : 0
  );

  if (walletSelection.key === "create") {
    const wallet = await solana.createWallet();
    await session.setGeneratedWallet(wallet);
    printSummary("Wallet", `${wallet.publicKey} created and selected`);
  } else if (walletSelection.key === "select") {
    const address = (await rl.question(accent("Wallet address: "))).trim();
    if (address) {
      await session.setWallet(address);
    }
  }

  await session.completeOnboarding();

  printPanel("Setup Complete", [
    `Model: ${session.state.model}`,
    `Cluster: ${session.state.network}`,
    `RPC: ${session.state.rpcUrl}`,
    `Strategy: ${session.state.currentStrategy}`,
    `Wallet: ${session.state.currentWallet || "none selected"}`,
    "",
    "Use /help for the command index.",
    "Ask for a goal in plain language and Orion will decide when to use long-running graph execution.",
    "Use /setup anytime to rerun this setup."
  ]);
}
