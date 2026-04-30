```text
 ██████  ██████╗ ██╗ ██████╗ ███╗   ██╗
██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║
██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║
██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║
╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║
 ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
```

# Orion

Agentic DeFi CLI for Solana. Ask questions in plain English — Orion plans, fetches live chain data, and returns grounded answers in your terminal.

## Install

```bash
npm install -g orion-ai-cli
```

Then launch:

```bash
orion
```

First launch runs a short onboarding to configure your model backend and Solana cluster.

## Setup

Copy `.env.example` to `.env` and fill in what you have:

```
OLLAMA_BASE_URL=https://ollama.com          # or http://localhost:11434 for local
OLLAMA_API_KEY=your_key                     # required for Ollama Cloud
OLLAMA_MODEL=gemma4:31b-cloud

SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=devnet

SOLSCAN_API_KEY=your_key                    # optional, unlocks richer snapshots
```

Settings are persisted in `~/.orion/config.env` after onboarding.

## What it does

- Inspects wallets, accounts, token accounts, transaction signatures, and programs
- Plans multi-step prompts and executes each step with live progress markers
- Falls back gracefully from Solscan → RPC when keys are missing
- Watches accounts and signatures in the background across restarts
- Runs small read-only Solana code snippets for verification
- Remembers recently analyzed addresses across turns

## Terminal UI

The interactive terminal shows real-time step progress as Orion works:

```
⏺ Classifying target as a wallet address  [1/3]
  ⎿  address  AbNZmD3ffemMzGo3xiaXzTJf7yb7odqc75pAsMWVWHbq
     network  devnet
⏺ Fetching Solscan account snapshot  [2/3]
  ⎿  source  Solscan Pro
     balance  0.004994399 SOL
     signatures  10 retrieved
⏺ Summarizing snapshot  [3/3]
  ⎿  model  gemma4:31b-cloud
```

Results that are key-value structured render as a summary panel:

```
┃ ⬡ [ SUMMARY ]
┃ ──────────────────────────────────────────────
┃ Address        AbNZmD3ffemMzGo3xiaXzTJf7yb7odqc75pAsMWVWHbq
┃ Owner                                   System Program
┃ Balance                             0.004994399 SOL
┃ Executable                                    false
```

## Slash commands

| Command | What it does |
|---|---|
| `/status` | Show session state, model, network, wallet |
| `/models` | List available Ollama models |
| `/cluster devnet\|testnet\|mainnet` | Switch Solana network |
| `/rpc` | Show current RPC endpoint |
| `/rpc call <method> [params]` | Raw RPC call |
| `/rpc set <url>` | Set a custom RPC URL |
| `/wallet create` | Generate a new keypair |
| `/wallet select <address>` | Set active wallet |
| `/wallet balance [address]` | Check SOL balance |
| `/portfolio [address]` | Show token portfolio |
| `/account <address>` | Inspect an account |
| `/tx <signature>` | Decode a transaction |
| `/sigs <address> [limit]` | Recent signatures |
| `/program <programId>` | Inspect a program |
| `/fees [address...]` | Estimate fees |
| `/tasks` | List background tasks |
| `/task-status <id>` | Check task status |
| `/resume <id>` | Resume a paused task |
| `/cancel <id>` | Cancel a task |
| `/exec [js\|file]` | Run a Solana snippet |
| `/run <command>` | Run a shell command |
| `/patch <file>` | Apply a file patch |
| `/read <path>` | Read a file |
| `/voice <text>` | Speak output |
| `/help` | List all commands |

## Example prompts

```
analyze this wallet AbNZmD3ffemMzGo3xiaXzTJf7yb7odqc75pAsMWVWHbq
get the last 5 transactions
tell me about this signature 5cVXhg...jSnA
watch this wallet and alert me if the balance changes
compare this wallet across devnet and mainnet
what is a token account?
```

## HTTP mode

For scripting and automation:

```bash
orion --serve
```

```bash
curl -s http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{"prompt":"analyze this wallet AbNZmD3ffemMzGo3xiaXzTJf7yb7odqc75pAsMWVWHbq"}'
```

Set `ORION_PORT` to change the port.

## Notes

- Restart Orion after editing `.env`
- Watch tasks survive restarts and resume automatically
- Context window usage is shown live in the header bar
- `SOLSCAN_API_KEY` unlocks token balances, DeFi positions, and richer transaction detail
