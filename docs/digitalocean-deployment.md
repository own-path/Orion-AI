# DigitalOcean Deployment Guide

ORION now uses two DigitalOcean runtimes:

- A Droplet for `bot-service` and `agent-service`
- A managed DigitalOcean AI Platform agent for reasoning and chat

This matches the ADK model in DigitalOcean’s docs: custom agent code is deployed as a hosted service with an `@entrypoint`, tested locally via `gradient agent run`, and invoked remotely through a deployed `/run` endpoint.

## 1. Create the droplet

- Use Ubuntu 24.04 or current LTS.
- Pick a basic droplet with at least 2 GB RAM for hackathon use.
- Open inbound ports `22`, `8080`, and `3000` if you want HTTP access for testing.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Deploy the DigitalOcean agent runtime

The ADK is in [`services/orion-do-agent`](../services/orion-do-agent/README.md).

On your development machine:

```bash
cd services/orion-do-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
gradient agent run
```

DigitalOcean documents that local ADK testing exposes `http://0.0.0.0:8080/run`, and deployment is done with `gradient agent deploy`. After deployment, DigitalOcean returns a hosted `/run` URL under `agents.do-ai.run`.

Then deploy:

```bash
export GRADIENT_MODEL_ACCESS_KEY="<your_model_key>"
export DIGITALOCEAN_API_TOKEN="<your_do_api_token>"
gradient agent deploy
```

Record:

- deployed `DO_AGENT_RUN_URL`
- `DO_AGENT_ACCESS_KEY` for the endpoint
- your chosen `ORION_AGENT_MODEL_ID` for the ADK agent

## 4. Upload the droplet project

```bash
git clone <your-repo-url>
cd Orion-AI
cp .env.example .env
```

Fill `.env` with:

- Telegram bot token
- DigitalOcean agent run URL
- DigitalOcean agent access key
- Snowflake credentials
- ElevenLabs API key and voice ID
- Solana RPC URL

## 5. Start the droplet runtime

```bash
docker compose up --build -d
docker compose logs -f agent-service
docker compose logs -f bot-service
```

The droplet remains always-on. The `agent-service` loop stays resident and evaluates all active users every `ORION_LOOP_INTERVAL_MS`, but now it delegates reasoning to the hosted DigitalOcean AI agent.

## 6. Operate the system

- `bot-service` polls Telegram and forwards commands to `agent-service`
- plain Telegram text messages are sent to the DigitalOcean agent through `agent-service`
- `agent-service` exposes HTTP endpoints on port `8080`
- audit logs land in Snowflake table `ORION_AUDIT_LOGS`
- generated audio files are written under `/app/data/voice`
- the DigitalOcean agent endpoint remains the conversational and decision runtime

## 7. Optional PM2 alternative

Docker Compose is the primary path. If you need a non-Docker fallback:

```bash
npm install
pm2 start services/agent-service/index.js --name orion-agent
pm2 start services/bot-service/index.js --name orion-bot
pm2 save
```
