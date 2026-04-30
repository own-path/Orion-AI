```text
 ██████  ██████╗ ██╗ ██████╗ ███╗   ██╗
██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║
██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║
██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║
╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║
 ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
```

# ORION

Orion is an agentic DeFi CLI for Solana. It runs from the terminal, uses Ollama for local reasoning, and treats live chain data as the source of truth.

## What it does

- plans first, then splits large prompts into smaller steps
- inspects Solana wallets, accounts, signatures, token accounts, and programs
- uses Solscan when available and falls back to RPC when needed
- queues long-running work as background tasks or watches
- runs small read-only Solana code snippets when code is the fastest way to verify something
- keeps shell execution and file edits behind explicit confirmation

## Quick start

1. Copy `.env.example` to `.env`.
2. Set `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and `SOLSCAN_API_KEY` if you have one.
3. Run `npm start` or `node bin/orion.js`.
4. Ask for what you want in plain language.

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
- The `bin/orion.js` entrypoint is the supported terminal launcher.
