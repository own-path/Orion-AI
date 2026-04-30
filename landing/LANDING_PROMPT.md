# Orion — Landing Page Design Prompt

---

## What is Orion

**Orion** is an agentic command-line interface for Solana operators and learners.

It runs entirely in your terminal. You write plain-text prompts — "tell me everything about this
address", "watch this account and alert me when it changes", "explain what happened in this
transaction" — and Orion decomposes the goal into ordered steps, executes each one against live
on-chain data, and returns clean, grounded output. No browser. No dashboard. No hallucinated
numbers.

**The core loop:**

```
prompt → plan → steps execute inline → grounded response
```

Every answer is backed by a real RPC call or Solscan snapshot. The model never invents balances,
owners, or slot numbers.

---

## What it actually does — feature by feature

### 1. Intelligent prompt planning

Every input goes through a two-phase process before anything hits the chain:

1. **Classification** — Orion's heuristic layer detects whether the prompt is a direct lookup
   (a Solana address or signature is present), a watch request, a multi-step investigation, or a
   simple question.

2. **Decomposition** — For complex prompts, Orion asks its local model (via Ollama) to produce a
   structured JSON plan: `{ mode, title, summary, needsBackground, steps[] }`. Each step has a
   `title` and `goal`. If the model fails to return valid JSON, Orion falls back to heuristic plans.

3. **Execution** — Steps run sequentially with spinner feedback. Results from earlier steps are
   passed as context to later steps. After all steps complete, a synthesis pass produces the final
   response.

Modes the planner can assign:
- `lookup` — direct address/signature inspection, no tool loops
- `task` — multi-step execution with synthesis
- `watch` — create a durable subscription
- `answer` — single direct response

---

### 2. On-chain data — what Orion can fetch

**Account inspection:**
- SOL balance (lamports → SOL conversion)
- Account metadata: owner program, executable flag, data length, rent epoch
- Account comparison across devnet and mainnet simultaneously
- Portfolio state with allocation limits based on operator strategy

**Transaction inspection:**
- Recent signatures for any address (configurable limit)
- Full parsed transaction: signature, slot, block time, fee, instruction count, involved accounts
- Decoded instruction details when Solscan Pro API is configured
- Transaction actions (swap, transfer, stake, etc.) from Solscan action decoder

**Token accounts:**
- SPL token account enumeration for any wallet
- Token balances and mint addresses

**Program accounts:**
- All accounts owned by a given program ID
- Configurable fetch limit

**Fee intelligence:**
- Recent prioritization fee samples for specific accounts
- Useful for estimating transaction cost before submission

**RPC direct calls:**
- `/rpc call <method> [params]` can call any Solana JSON-RPC method directly
- Commitment level: confirmed
- Returns raw parsed response

**Data sources Orion uses:**
- **Solana RPC** (primary, always available): `@solana/web3.js` Connection API
- **Solscan Pro API** (optional, enhances lookups): account detail, transaction actions,
  portfolio, token accounts — Orion prefers Solscan when an API key is configured and
  falls back to RPC automatically when it isn't

---

### 3. Watch tasks — durable subscriptions

Orion can subscribe to on-chain events and react to them without you staying at the prompt.

Three watch types:
- **Account watch** — fires whenever an account's state changes. Payload includes slot,
  address, and normalized account info.
- **Signature watch** — fires once when a transaction confirms. Payload includes slot,
  status (confirmed/failed), and error if any. Auto-cancels after firing.
- **Logs watch** — subscribes to program logs or all logs. Payload includes slot,
  signature, and raw logs array.

Watch tasks are durable — they persist in `~/.orion/tasks.json` and are automatically
resumed when Orion restarts. Each event is stored in the task history (capped at 30
entries). When a prompt is attached to a watch, Orion runs an analysis task on each
event payload and stores the result.

Create a watch via natural language: "watch this account", "monitor this signature",
"track events on this program". Or via `/cancel <id>` to stop one.

---

### 4. Multi-step task execution

When a prompt requires several distinct operations — inspect, then compare, then explain —
Orion:

1. Builds a step-by-step plan (from the LLM planner)
2. Executes each step sequentially with a spinner and progress marker (`• 1/3 ...`)
3. Passes the results of earlier steps as context to later steps
4. Runs a final synthesis pass to produce a coherent summary
5. Prints the response inline — no background queue, no waiting

Tasks that were previously queued silently are now executed immediately, with visible
progress at each step.

---

### 5. Sandboxed code execution

Orion can run small read-only Solana JavaScript snippets for learning and verification.

The sandbox provides:
- `solana` — the Solana service instance
- `session` — current operator context (wallet, network, strategy)
- `PublicKey`, `Connection`, `Keypair`, `LAMPORTS_PER_SOL`, `clusterApiUrl` from `@solana/web3.js`
- `fetch`, `Buffer`, `JSON`, `Math`, `Date`

Blocked: `require`, `process`, `module`, `exports` — no filesystem or network escapes.

Timeout: 15 seconds. Output is captured from `console.log` calls and returned structured.

Pre-defined templates:
- `wallet` — inspect the selected wallet with balance, account info, recent signatures
- `token-account` — enumerate SPL token accounts
- `compare-clusters` — compare wallet balance across devnet and mainnet
- `signatures` — dump recent signatures for any address

Used via `/exec js <inline code>`, `/exec file <path>`, `/exec template <name>`.

---

### 6. File operations (confirmation-gated)

Orion can inspect and modify workspace files, but always asks before writing.

- `/read <path>` — returns first 200 lines of any file
- `/run <shell command>` — runs a shell command after an explicit [y/N] prompt
- `/patch <file> "<instruction>"` — asks the model to rewrite the file, generates a unified
  diff (via `git diff --no-index`), previews it, and applies only after confirmation
- `/rust-client [dir]` — scaffolds an official Solana Rust client project structure,
  confirmation required before writing

The model is instructed never to claim it has run shell commands or written files — only
the explicit slash commands can trigger these operations.

---

### 7. 17 agentic tools available to the model

When running in task or chat mode, the model can call these tools directly:

| Tool | What it does |
|---|---|
| `get_wallet_balance` | SOL balance for any address |
| `get_portfolio` | Portfolio summary with strategy allocation |
| `inspect_account` | Account metadata from RPC |
| `lookup_solana_explorer` | Solscan-backed snapshot (account or tx) |
| `call_solana_rpc` | Raw JSON-RPC method call |
| `explain_transaction` | Fetch and summarize a transaction |
| `get_recent_signatures` | Recent signatures for an address |
| `scan_program_accounts` | All accounts owned by a program |
| `get_recent_prioritization_fees` | Fee samples for addresses |
| `queue_background_task` | Create a durable long-running task |
| `create_watch_task` | Subscribe to account/signature/logs events |
| `list_durable_tasks` | Show background tasks and watches |
| `read_workspace_file` | Read a file from the workspace |
| `request_shell_command` | Request shell execution (routes to /run) |
| `execute_solana_code` | Run a sandboxed JS snippet |
| `request_file_patch` | Request a file rewrite (routes to /patch) |
| `request_rust_client_scaffold` | Scaffold a Rust client project |

The model uses these tools in a LangGraph `agent → tools → agent` loop until no more
tool calls are needed, then returns the final response.

---

### 8. Slash commands reference

**Network & cluster:**
- `/cluster [devnet|testnet|mainnet]` — switch Solana cluster
- `/rpc info` — current RPC configuration
- `/rpc methods` — list common RPC methods
- `/rpc call <method> [json params]` — raw RPC call
- `/rpc set <url>` — set custom RPC endpoint

**Wallet & inspection:**
- `/wallet create` — generate a new keypair (stored in session, never written to disk unencrypted)
- `/wallet select <address>` — set active wallet
- `/wallet balance [address]` — check SOL balance
- `/portfolio [address]` — full portfolio with allocation
- `/account <address>` — inspect an account
- `/tx <signature>` — explain a transaction
- `/sigs <address> [limit]` — recent signatures
- `/program <programId> [limit]` — scan program-owned accounts
- `/fees [address...]` — recent prioritization fees
- `/airdrop [sol] [address]` — request devnet/testnet SOL (blocked on mainnet)

**Tasks & watches:**
- `/tasks` — list durable background tasks and watches
- `/task-status <id>` — detailed view of one task
- `/resume <id>` — resume a cancelled task
- `/cancel <id>` — stop a task or watch

**Code & workspace:**
- `/exec js <code>` — run inline JS in sandbox
- `/exec file <path>` — run JS file in sandbox
- `/exec template <name>` — run a predefined snippet
- `/exec templates` — list available templates
- `/read <path>` — read a workspace file
- `/run <command>` — run a shell command (requires confirmation)
- `/patch <file>` — rewrite a file with diff preview (requires confirmation)
- `/rust-client [dir]` — scaffold a Rust client project

**Session:**
- `/model [name]` — switch Ollama model
- `/models` — list locally available models
- `/strategy [conservative|balanced|aggressive]` — set DeFi execution strategy
- `/status` — show full session state
- `/history` — show conversation transcript
- `/clear` — clear transcript
- `/setup` — rerun onboarding
- `/voice <text>` — speak text via ElevenLabs
- `/tools` — list available harness tools
- `/exit` — exit Orion

---

### 9. Session state — what Orion remembers

Persisted to `~/.orion/cli-session.json` across restarts:

- Active wallet address
- Chosen Ollama model
- Solana network and RPC endpoint
- Operator strategy (conservative / balanced / aggressive)
- Onboarding completion flag
- Recent conversation history (capped at 12 entries)
- Workspace path

The strategy setting shapes how the portfolio tool computes allocation limits:

| Strategy | Max allocation | Risk tolerance |
|---|---|---|
| conservative | 15% | 0.2 |
| balanced | 30% | 0.5 |
| aggressive | 50% | 0.8 |

---

### 10. Voice output

Optional integration with ElevenLabs:

- `/voice <text>` generates an MP3 from the provided text
- Audio files written to `data/voice/`
- Configurable voice ID, model, and loading sound effect
- Loading SFX is pre-generated and cached on first use
- Requires `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env`

---

### 11. Onboarding

First-run wizard (`~/.orion/cli-session.json` `onboardingDone: false`):

1. **Welcome** — explains planning-first approach and safety guarantees
2. **Model selection** — picks from detected local Ollama models or accepts a custom name
3. **Cluster selection** — devnet / testnet / mainnet-beta (default: devnet)
4. **Strategy selection** — conservative / balanced / aggressive
5. **Wallet context** — skip, generate new, or select existing address
6. **Confirmation** — display all choices before saving

Re-run any time with `/setup`.

---

### 12. Model backend

Orion uses **Ollama** as its reasoning backend — local or remote.

- Defaults to `gemma4:31b-cloud` via Ollama Cloud
- Switches models per-session with `/model`
- Health check at startup: if Ollama is unreachable or the model isn't found, Orion warns
  and lists installed alternatives
- Planning calls use `temperature: 0.1` for determinism
- Task calls use `temperature: 0.2` for slightly more generative synthesis
- LangGraph MemorySaver provides per-thread conversation checkpointing

---

## Design direction

Terminal-native. Not a SaaS product page — a printed CLI manual. Every structural element
should echo the Orion shell: horizontal rules as dividers, monospace font everywhere, color
only where the CLI uses color, the blinking cursor as the only animation beyond the blink.

The ASCII logo is the hero. No illustrations, no icons beyond the Unicode characters the
CLI itself uses (`◆`, `⎿`, `◉`, `≈`, `▣`, `•`).

---

## Color palette

Direct mapping from CLI ANSI codes:

| Role | Hex | Usage |
|---|---|---|
| Background | `#0c0c0f` | Page background |
| Surface | `#111116` | Cards, terminal preview, code blocks |
| Primary | `#8b7afa` | Logo, `❯` arrows, step markers, active accents |
| Secondary | `#ff87ff` | Hover highlights |
| Accent | `#00d7ff` | Links, network labels, age timestamps |
| Success | `#5fff87` | Install `$` prompt, status dots |
| Warning | `#ffd75f` | Model name, cost label, key names in feature grid |
| Danger | `#ff5f5f` | Error states only |
| Border | `#3a3a4a` | All horizontal rules, card outlines |
| Muted | `#606070` | Secondary text, hints, rule dashes, response body |
| Text | `#c8c8d8` | Primary content, terminal input text |

---

## Typography

- **Font:** `JetBrains Mono` → `Fira Code` → `Cascadia Code` → `ui-monospace`
- Monospace everywhere — zero sans-serif exceptions
- Base: 14px / 1.6 line-height
- Headings: weight 700, no letter-spacing tricks
- Labels: 11–12px, uppercase, `letter-spacing: 0.04em`

---

## Layout — section by section

### Top bar

Full-width sticky header. `1px solid border` bottom edge. No background fill.

```
orion                                    features   install   github
```

- `orion` in primary, bold, 14px
- Nav: muted color, 12px, hover → text
- No shadow, no blur

---

### Hero

Centered column. `padding-top: 5rem`.

**ASCII logo** — render in `<pre>`, color: primary. Font size: `clamp(7px, 1.2vw, 13px)`.
Do not CSS-scale — shrink font on mobile.

```
 ██████  ██████╗ ██╗ ██████╗ ███╗   ██╗
██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║
██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║
██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║
╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║
 ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
```

**Underline bar** — same character width as logo, immediately below, color: muted.

```
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

**Version line** — centered, 12px.
`v0.1.0` muted · dot muted · `gemma4:31b-cloud` warning color

**Headline** — `clamp(1.4rem, 4vw, 2.4rem)`, weight 700:

```
Agentic DeFi CLI for Solana
```

`DeFi CLI` in primary. Rest in text color. No italic.

**Sub-copy** — max-width 560px, 13px, muted, line-height 1.7:

```
Plain-text prompts → on-chain intelligence.
Plans decompose automatically. Each step executes against live chain data.
Inspect wallets, trace transactions, monitor accounts — all from your terminal.
No browser. No dashboard. No hallucinated numbers.
```

---

### Install block

Surface bg, 1px border border, border-radius 6px. Single line.

```
$   npm install -g orion-ai                             [copy]
```

- `$` in success green
- `npm install -g orion-ai` in text color
- `[copy]` right-aligned: 1px border, muted text → primary on hover
- On copy: text → `copied!`, color → success, reverts after 2s

Below, 11px muted:
```
Requires Node.js 18+  ·  view on GitHub ↗
```

---

### Terminal preview

Realistic terminal window. Max-width 720px. Surface bg, 1px border, border-radius 8px.

**Window bar** — `#1a1a22` bg, traffic lights (red/yellow/green, 10px circles), centered
title `orion — devnet` in muted.

**Body** — shows a real address lookup interaction. Font size 12px.

```
orion  ·  devnet  ·  no wallet
──────────────────────────────────────────────── · devnet

❯  tell me everything about AbNZmD3ffemMzGo3xiaXzTJf7yb7odqc75pAsMWVWHbq

• 1/3  Classifying target as a wallet address
• 2/3  Fetching Solana RPC account snapshot
• 3/3  Summarizing snapshot through the harness

   System account on mainnet-beta.

   balance   0.743 SOL
   owner     System Program
   activity  10 finalized txns · slots 416566026 – 416567535
   data      0 bytes

  ▣ gemma4:31b-cloud  ·  3.2s

──────────────────────────────────────────────── · devnet
❯ █
```

Color mapping:
- Header row: `orion` primary, `devnet` accent, rest muted
- Rule lines: border color
- `❯` arrow: primary, bold
- Input text: text color
- `• N/N` numbers: muted; step label: primary
- Response body: text color; key labels (`balance`, `owner`, etc.): warning
- `▣ model · Xs` footer: muted, model name: warning
- Cursor `█`: primary, CSS blink `step-end` 1.1s

---

### Feature grid

4 cells, `repeat(auto-fit, minmax(220px, 1fr))`, gap: 1px on border-colored parent.
Each cell: surface bg, `padding: 1.2rem 1.4rem`.

| Icon | Title | Body |
|---|---|---|
| `◆` | **Live chain data** | Every answer is grounded in real Solana RPC state. Solscan Pro enhances lookups when configured. No hallucinated balances. |
| `⎿` | **Multi-step planning** | Complex prompts decompose into ordered steps. Each step runs with a spinner. Results carry forward as context. |
| `◉` | **Watch tasks** | Subscribe to account changes, signature confirmations, or program logs. Orion reacts when events fire and stores the history. |
| `≈` | **17 agentic tools** | The model calls tools directly — RPC, Solscan, code execution, file reads — inside a LangGraph agent loop until the work is done. |

Icons: primary. Titles: 12px uppercase bold text color. Body: 11px muted.

---

### CLI footer

The most important design element. Must look exactly like the real Orion prompt footer.

```
──────────────────────────────────────────────────────────── · devnet
 ❯ █
─────────────────────────────────────────────────────────────────────
 [/help] commands  [tab] complete  [↑↓] history  [esc] cancel  [@] reference
```

Implementation:
- **Top rule:** `flex-row` — `flex: 1` `1px` line in border, then ` · devnet ` in muted
- **Prompt row:** `❯` primary bold, blinking `█` cursor in primary
- **Bottom rule:** full-width `1px` border color
- **Hint row:** 11px muted. `[bracket]` items styled as text color, surrounding words muted
- No padding below hint row — footer is flush at the bottom of the viewport

---

## Interactions

| Element | Behavior |
|---|---|
| Copy button | Copies `npm install -g orion-ai`, `copied!` for 2s |
| Nav: features | Smooth-scroll to `#features` |
| Nav: install | Smooth-scroll to `#install` |
| GitHub link | Opens in new tab |
| Cursor `█` | `animation: blink 1.1s step-end infinite`, 50% opacity 0 |
| Topbar | Sticky, no blur, no fill |

---

## Responsive

| Width | Changes |
|---|---|
| < 600px | Nav hidden, logo font 6px, feature grid 1 column |
| 600–900px | Logo scales via clamp, terminal full-width |
| > 900px | Full layout |

---

## Constraints

- No gradients, shadows, glassmorphism
- No sans-serif fonts anywhere
- No images or illustrations
- No emoji
- No social links, copyright notices, or footer marketing copy
- No color fills beyond surface `#111116` on cards
- Only one animation: the cursor blink
- Unicode characters allowed: `◆ ⎿ ◉ ≈ ▣ • ❯ █ ▀ ─`

---

## Deliverable

Single `index.html`. All CSS inlined in `<style>`. No JS frameworks.
Copy button: ~10 lines of vanilla JS. Optionally import JetBrains Mono from Google Fonts.
