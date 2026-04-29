# ORION AI

ORION AI is a hackathon MVP for an autonomous DeFi co-pilot on Solana. It runs as two always-on services on a single DigitalOcean droplet:

- `bot-service`: Telegram control plane
- `agent-service`: autonomous worker loop and HTTP API

The reasoning layer is powered directly by the Gemini API. The droplet services call Gemini for autonomous decisions and Telegram conversation.

Shared modules provide Solana wallet handling, Snowflake audit logging, ElevenLabs voice generation, Gemini invocation, and file-backed runtime state.

## Architecture

- DigitalOcean droplet runs `bot-service` and `agent-service` via Docker Compose
- Telegram is the operator interface
- Agent loop wakes every 60 seconds and evaluates all active users
- Snowflake is the audit system of record via `ORION_AUDIT_LOGS`
- Solana `@solana/web3.js` handles wallet creation and portfolio reads
- ElevenLabs generates MP3 summaries and confirmations
- Telegram freeform messages are forwarded to Gemini through `agent-service`
- The Gemini model is configured through `GEMINI_MODEL`

## Quick start

1. Copy `.env.example` to `.env` and fill in real credentials.
2. Set `GEMINI_API_KEY` in `.env`.
3. Optionally change `GEMINI_MODEL` if you want a different Gemini model.
4. Run `docker compose up --build`.
5. Open Telegram and issue `/start` to your bot.

Supporting setup guides are in [`docs/`](./docs).
