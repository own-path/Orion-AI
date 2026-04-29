# ORION DigitalOcean Agent

This is the reasoning runtime for ORION AI, intended for deployment on DigitalOcean AI Platform using the Agent Development Kit (ADK).

## What it does

- accepts `mode: "chat"` payloads from Telegram-originated conversations
- accepts `mode: "decision"` payloads from the 60-second autonomous worker loop
- calls DigitalOcean serverless inference using your `GRADIENT_MODEL_ACCESS_KEY`
- requires you to choose the model later via `ORION_AGENT_MODEL_ID`
- returns either a conversational response or structured trading JSON

## Local run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GRADIENT_MODEL_ACCESS_KEY="<your_model_key>"
gradient agent run
```

DigitalOcean documents that `gradient agent run` exposes a local `/run` endpoint for testing.

## Deploy

```bash
export GRADIENT_MODEL_ACCESS_KEY="<your_model_key>"
export DIGITALOCEAN_API_TOKEN="<your_do_api_token>"
gradient agent deploy
```

After deployment, save the generated hosted `/run` URL and the endpoint access key into the droplet `.env` as:

- `DO_AGENT_RUN_URL`
- `DO_AGENT_ACCESS_KEY`

## Payloads

Chat:

```json
{
  "mode": "chat",
  "userId": "12345",
  "message": "What did Orion do today?",
  "strategy": "balanced"
}
```

Decision:

```json
{
  "mode": "decision",
  "userId": "12345",
  "strategy": "balanced",
  "portfolio": {
    "solBalance": 1.25,
    "maxAllocatableSol": 0.37
  },
  "marketContext": {
    "marketRegime": "cautious"
  }
}
```
