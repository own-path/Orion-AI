# Project Story

## About the project

Orion started from a simple frustration: blockchain has always felt powerful, but also intimidating. The terminology, the tooling, and the sheer amount of on-chain data make it hard to know where to begin. I wanted to build something that lowers that barrier instead of adding to it.

That led me to build Orion as an agentic DeFi CLI for Solana. The idea is simple: speak in plain language, inspect live chain data, and let the assistant do the work of breaking a big question into smaller steps. Instead of forcing someone to memorize commands or manually stitch together RPC calls, Orion turns a single prompt into a guided investigation.

The main model behind Orion is Gemma 4. I also built the landing page with Gemini 3.1 Pro via Base44:
https://orion-defi-link.base44.app

I learned a lot while building it. One of the biggest things I had to understand better was DeFi, or decentralized finance. In practical terms, DeFi is an open financial system built on blockchain infrastructure that lets people borrow, save, trade, and interact with financial services through code rather than a centralized intermediary. People are drawn to it because it can give them more control over their funds, broader access to global markets, always-open services, faster transfers, and more transparency than traditional finance.

Orion is my attempt to make that world easier to approach. If blockchain feels abstract, the CLI turns it into something concrete: inspect a wallet, trace a transaction, compare activity across clusters, or watch an account over time and come back with evidence.

## How I built it

I built Orion as a terminal-first harness with an agentic layer on top. The CLI plans first, then decides whether a prompt should be answered directly, split into smaller tasks, or turned into a durable background watch.

The Solana side is grounded in live data. Orion can inspect wallets, transactions, token accounts, programs, and signatures using RPC and Solscan when available. It also keeps short-term session memory so follow-up questions can reuse evidence instead of starting over.

The main design principle was to keep the model honest. If the data is on chain, Orion should fetch it. If it is public documentation or ecosystem context, Orion should verify it from references. If the task is too large, Orion should break it into smaller steps and work through them one by one.

You can think of the flow as:

$$
r = g(p, e)
$$

where $p$ is the user prompt, $e$ is the evidence Orion gathers from Solana or web sources, and $r$ is the final response.

## What I learned

I learned that the hard part is not calling an API. The hard part is orchestration:

- deciding when to look up data versus when to reason
- keeping short-term memory useful across follow-up prompts
- avoiding recursive tool loops
- making the interface fast enough that it still feels like a terminal tool
- presenting chain data in a way that is readable to someone new to Solana

I also learned that a good Solana learning tool should teach by doing. A newcomer should be able to ask, “what is this wallet doing?” or “what does this transaction mean?” and get a grounded answer with enough structure to learn from it.

## Challenges I faced

The biggest challenge was the orchestration layer. Getting the agent to split work into smaller tasks, reuse prior evidence, and avoid recursion limits took more work than the raw Solana lookups.

Another challenge was speed. Some prompts naturally want recent transaction history, then a deeper parse of each signature. If Orion always fetched too much, it became slow. If it reused stale memory too aggressively, it gave incomplete answers. I had to tune that balance carefully.

UI and formatting were also a real challenge. I wanted the output to feel like a polished terminal experience, not a wall of text. That meant making the summary panels, progress lines, and prompt layout compact while still being transparent about what Orion was doing.

## Why this matters

Solana and DeFi can feel overwhelming at first. Orion tries to make them approachable without dumbing them down. The goal is not to hide the chain, but to help people interrogate it directly and learn from the evidence.

That is why Orion is built around one principle: let the user ask naturally, and let the harness figure out the smallest truthful path to an answer.

## References

- [Ethereum.org: What is DeFi?](https://ethereum.org/pcm/defi/)
- [Investopedia: Understanding Decentralized Finance (DeFi)](https://www.investopedia.com/decentralized-finance-defi-5113835/)
