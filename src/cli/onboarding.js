import { getStrategyConfig, STRATEGIES } from "../../services/shared/strategies.js";
import { config, persistConfig } from "../../services/shared/config.js";
import { printPanel, printSummary } from "./renderer.js";
import { accent, danger, info, muted, success, warn } from "./theme.js";

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

function ollamaInstallCommand() {
  if (process.platform === "win32") {
    return {
      label: "PowerShell install script",
      command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://ollama.com/install.ps1 | iex"'
    };
  }

  return {
    label: "official install script",
    command: "curl -fsSL https://ollama.com/install.sh | sh"
  };
}

async function hasOllamaBinary(shell) {
  try {
    const probe = process.platform === "win32"
      ? 'where ollama >NUL 2>&1 && echo yes || echo no'
      : 'command -v ollama >/dev/null 2>&1 && echo yes || echo no';
    const result = await shell(probe);
    return String(result.stdout || "").toLowerCase().includes("yes");
  } catch {
    return false;
  }
}

async function installOllama(shell) {
  const { command } = ollamaInstallCommand();
  const result = await shell(command);
  if (result.code !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr || `Ollama install failed with exit code ${result.code}`);
  }
}

export async function runOnboarding(ctx) {
  const { rl, ollama, session, solana, shell, harness } = ctx;
  const health = await ollama.checkHealth();
  const binaryPresent = shell ? await hasOllamaBinary(shell) : false;

  printPanel("Welcome", [
    success("ORION is now configured as an agentic DeFi CLI for Solana."),
    "This setup runs once on first launch and can be rerun with /setup.",
    "",
    `${info("Harness")}: LangGraph orchestration, tool calling, long-running task mode`,
    `${info("Model backend")}: Ollama cloud or local daemon`,
    `${info("Safety")}: shell commands and file writes always require confirmation`
  ]);
  await rl.question(accent("Press Enter to continue "));

  const ollamaMode = await promptChoice(
    rl,
    "Step 1 · Ollama Setup",
    [
      "Choose how Orion should talk to Ollama.",
      binaryPresent
        ? muted("A local Ollama binary is already available.")
        : warn("No local Ollama binary was detected yet.")
    ],
    [
      {
        key: "cloud",
        label: "Ollama Cloud",
        note: "use ollama.com with an API key"
      },
      {
        key: "local",
        label: "Local Ollama",
        note: binaryPresent ? "use the local daemon already installed" : "install Ollama on this machine"
      },
      {
        key: "skip",
        label: "skip for now",
        note: "leave Ollama settings unchanged"
      }
    ],
    health.available ? 0 : 1
  );

  if (ollamaMode.key === "cloud") {
    const apiKey = (await rl.question(accent("Ollama API key: "))).trim();
    if (apiKey) {
      await persistConfig({
        OLLAMA_BASE_URL: "https://ollama.com",
        OLLAMA_API_KEY: apiKey,
        OLLAMA_REQUIRED: "true"
      });
      printSummary("Ollama", `Cloud key saved to ${config.persistentConfigFilePath}`);
    } else {
      printSummary("Ollama", "No API key entered; keeping the current setting");
    }
  } else if (ollamaMode.key === "local") {
    let configuredLocal = binaryPresent;
    if (!binaryPresent && shell) {
      printPanel("Install Ollama", [
        "Ollama was not found in PATH.",
        `Install with the official script: ${ollamaInstallCommand().command}`,
        "",
        "This downloads Ollama so Orion can run locally without a cloud key."
      ]);
      const installNow = await promptChoice(
        rl,
        "Install Ollama now?",
        ["Choose whether Orion should run the official installer for you."],
        [
          { key: "yes", label: "yes, install Ollama", note: "runs the official installer" },
          { key: "no", label: "no, I’ll install it later", note: "continue without installing" }
        ],
        0
      );
      if (installNow.key === "yes") {
        printSummary("Ollama", "Running the official installer...");
        try {
          await installOllama(shell);
          printSummary("Ollama", "Install completed. You may need to relaunch Ollama once.");
          configuredLocal = true;
        } catch (error) {
          printPanel("Ollama Install Failed", [
            danger(error instanceof Error ? error.message : String(error)),
            "",
            `Try the official command manually: ${ollamaInstallCommand().command}`
          ]);
        }
      }
    }

    if (configuredLocal) {
      await persistConfig({
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        OLLAMA_API_KEY: "",
        OLLAMA_REQUIRED: "true"
      });
    }
  }

  ollama.refreshConfig?.();
  harness?.refreshRuntime?.();

  const localModels = await ollama.listModels().catch(() => []);
  const modelOptions = [
    ...localModels.map((name) => ({
      key: name,
      label: name,
      note: binaryPresent ? "available in Ollama" : "available from Ollama"
    })),
    {
      key: "custom",
      label: "custom model",
      note: "enter a model name manually"
    }
  ];

  const modelSelection = await promptChoice(
    rl,
    "Step 2 · Default Model",
    [
      "Choose the default model for normal turns and long-running graph tasks.",
      localModels.length
        ? `Detected ${localModels.length} model(s) from the current Ollama backend.`
        : warn("No models were detected yet. You can still enter one manually.")
    ],
    modelOptions,
    0
  );

  const selectedModel =
    modelSelection.key === "custom"
      ? (await rl.question(accent("Enter Ollama model name: "))).trim() || session.state.model
      : modelSelection.key;
  await session.setModel(selectedModel);
  await persistConfig({
    OLLAMA_MODEL: selectedModel
  });
  ollama.refreshConfig?.();
  harness?.refreshRuntime?.();

  const clusterSelection = await promptChoice(
    rl,
    "Step 3 · Solana Cluster",
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
    "Step 4 · Operator Strategy",
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
    "Step 5 · Wallet Context",
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
