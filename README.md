```text
 ██████  ██████╗ ██╗ ██████╗ ███╗   ██╗
██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║
██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║
██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║
╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║
 ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
```

# ORION

Orion is an agentic DeFi CLI for Solana with an optional HTTP mode. Install it once, then call `orion` from your terminal. On first launch it walks you through Ollama Cloud key setup or a local Ollama install, then uses live chain data as the source of truth.

## What it does

- plans first, then splits large prompts into smaller steps
- inspects Solana wallets, accounts, signatures, token accounts, and programs
- uses Solscan when available and falls back to RPC when needed
- queues long-running work as background tasks or watches
- runs small read-only Solana code snippets when code is the fastest way to verify something
- keeps shell execution and file edits behind explicit confirmation

## Quick start

1. Install Orion globally:

   ```bash
   npm install -g orion-ai
   ```

2. Copy `.env.example` to `.env`.
3. Run `orion` once and complete the onboarding flow.
4. Orion will prompt for Ollama Cloud credentials or offer to install local Ollama, then save the result in `~/.orion/config.env`.
5. Set `SOLSCAN_API_KEY` if you have one.
6. Run `orion` for the interactive terminal, or `orion --serve` for HTTP mode.

## Install and run

After installation, you can launch Orion directly:

```bash
orion
```

The first launch runs onboarding so you can choose:

- Ollama Cloud with an API key
- Local Ollama install on your machine
- a model, Solana cluster, strategy, and wallet context

## HTTP mode

For scripting and automation, run the built-in HTTP server:

```bash
orion --serve
```

Then send a prompt:

```bash
curl -s http://127.0.0.1:8787/ask \
  -H 'content-type: application/json' \
  -d '{"prompt":"analyze this wallet 7jysTypkmEDg5CXXWuPaAcytWC5UxWUCmj9NUJb1NetG"}'
```

You can also request plain text:

```bash
curl -s http://127.0.0.1:8787/ask \
  -H 'accept: text/plain' \
  -H 'content-type: application/json' \
  -d '{"prompt":"what is devnet?"}'
```

Set `ORION_PORT` if you want a different port.

## Good prompts

- `what about 3tVWtRX2Eb6saUKgrJz1QxdMgQjAdZ5TMdJxuDBfiyqi`
- `tell me anything you know about this 5cVXhgAoNpSyx3QS15kVkUQoqo42s1aeggLRpUsp6ETG7kQQct3F5dyroTq68xtUv8TW5nMUHgnXRRKcRQr7jSnA`
- `track this wallet for the next few hours and report anything unusual`
- `inspect this program and explain the accounts it uses`
- `compare this wallet across devnet and mainnet`
- `show me how a token account works, then inspect one on chain`

## Useful commands

- `/status`
- `/models`
- `/rpc`
- `/rpc methods`
- `/rpc call <method> [json params]`
- `/rpc set <url>`
- `/wallet create`
- `/wallet select <address>`
- `/wallet balance [address]`
- `/portfolio [address]`
- `/account <address>`
- `/tx <signature>`
- `/sigs <address> [limit]`
- `/program <programId> [limit]`
- `/fees [address...]`
- `/read <path>`
- `/rust-client [dir]`
- `/run <shell command>`
- `/exec [js|file] ...`
- `/patch <file>`
- `/tasks`
- `/task-status <taskId>`
- `/resume <taskId>`
- `/cancel <taskId>`
- `/voice <text>`

## Notes

- `SOLSCAN_API_KEY` unlocks richer explorer snapshots.
- Restart Orion after changing `.env`.
- `orion` launches the interactive terminal UI.
- `orion --serve` launches the curlable HTTP server.
