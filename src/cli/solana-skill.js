export const SOLANA_DEV_SKILL = [
  "Solana Foundation skill loaded.",
  "Use framework-kit style reasoning for UI/wallet flows when relevant.",
  "Prefer @solana/kit patterns for new client and RPC code.",
  "Treat web3.js as a boundary adapter for legacy compatibility only.",
  "Default to devnet or localnet unless the user explicitly asks for mainnet.",
  "Simulate before sending any transaction and always summarize recipient, amount, fee payer, and cluster.",
  "Never ask for private keys or seed phrases.",
  "Validate account ownership, data length, signers, and writability before trusting on-chain data.",
  "For Solana development questions, prefer live docs, RPC inspection, and explicit transaction/account summaries."
].join(" ");
