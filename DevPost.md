# Orion

## Project Story

Blockchain has always felt powerful to me, but it also felt daunting. The concepts, tooling, and live on-chain data can be overwhelming when you are just trying to understand what is happening on Solana. I built Orion to break that barrier.

Orion is an agentic DeFi CLI for Solana. It lets users ask questions in plain language and then turns those prompts into live lookups, step-by-step analysis, and durable follow-up tasks. Instead of forcing people to memorize commands or manually stitch together RPC requests, Orion helps them learn by doing.

The main model behind Orion is Gemma 4. I also built the landing page with Gemini 3.1 Pro via Base44:
https://orion-defi-link.base44.app

One thing I learned while building Orion was what DeFi actually means in practice. DeFi, or decentralized finance, is an open financial system built on blockchain rails. It lets people borrow, save, trade, and use financial apps without relying on a centralized intermediary. People want DeFi because it can give them more control over their assets, broader access to global markets, always-open services, faster transfers, and more transparency than traditional finance.

Orion is designed to make that world easier to approach. A user can inspect a wallet, trace a transaction, compare activity across clusters, or monitor an account over time, and Orion will do the evidence gathering and organize the result into something readable.

## How I built it

I built Orion as a terminal-first harness with an agentic layer on top. The system plans first, then decides whether a prompt should be answered directly, split into smaller subtasks, or turned into a long-running watch.

The Solana integration is grounded in live data. Orion can inspect wallets, signatures, token accounts, programs, and account history using RPC and Solscan when available. It also keeps short-term session memory so follow-up prompts can reuse prior evidence instead of starting from scratch.

The orchestration strategy is the core of the project:

$$
r = g(p, e)
$$

where $p$ is the user prompt, $e$ is the evidence gathered from chain or documentation sources, and $r$ is the final response.

## What I learned

I learned that the hard part is not the API call. The hard part is orchestration:

- deciding when to answer directly versus when to investigate
- keeping short-term memory useful across follow-up prompts
- avoiding recursive tool loops
- balancing speed with completeness
- rendering chain data in a way that is readable to someone new to Solana

I also learned that a good blockchain learning tool should teach by doing. Orion tries to turn “what is this wallet doing?” or “what does this transaction mean?” into a grounded investigation, not just a generic explanation.

## Challenges

The biggest challenge was getting the orchestration layer to work reliably. Some prompts naturally need transaction history, then deeper parsing of each signature. If Orion fetched too much, it became slow. If it reused memory too aggressively, it could miss important context. Finding the right balance took a lot of iteration.

Another challenge was presentation. I wanted Orion to feel like a serious terminal tool, not a wall of text. That meant shaping the output into compact panels, clear progress indicators, and short answers that stay grounded in the evidence.

## Why it matters

Solana and DeFi can feel intimidating at first. Orion is my attempt to make them more approachable without hiding the underlying chain data. The goal is to help new users explore, learn, and build confidence through real on-chain interactions.

## References

- [Ethereum.org: What is DeFi?](https://ethereum.org/pcm/defi/)
- [Investopedia: Understanding Decentralized Finance (DeFi)](https://www.investopedia.com/decentralized-finance-defi-5113835/)
