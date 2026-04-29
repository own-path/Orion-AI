import json
import os
from typing import Any, Dict

import requests
from gradient_adk import entrypoint


MODEL_ID = os.getenv("ORION_AGENT_MODEL_ID")
INFERENCE_URL = "https://inference.do-ai.run/v1/chat/completions"


def call_model(messages: list[dict[str, str]], temperature: float = 0.2) -> str:
    api_key = os.getenv("GRADIENT_MODEL_ACCESS_KEY")
    if not api_key:
        raise RuntimeError("GRADIENT_MODEL_ACCESS_KEY is required")
    if not MODEL_ID:
        raise RuntimeError("ORION_AGENT_MODEL_ID is required")

    response = requests.post(
        INFERENCE_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": MODEL_ID,
            "messages": messages,
            "temperature": temperature,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]


def safe_parse_decision(content: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return {
            "action": "hold",
            "amount": 0,
            "reason": f"Could not parse decision JSON from model output: {content[:200]}",
            "confidence": 0,
        }

    return {
        "action": parsed.get("action", "hold"),
        "amount": float(parsed.get("amount", 0)),
        "reason": str(parsed.get("reason", "")),
        "confidence": float(parsed.get("confidence", 0)),
    }


def decision_messages(payload: Dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are ORION AI, a Solana DeFi copilot. "
                "Return only valid JSON with exactly these fields: "
                "action, amount, reason, confidence. "
                "action must be one of stake, swap, hold. "
                "confidence must be a number from 0 to 1. "
                "Never suggest an amount above portfolio.maxAllocatableSol."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(payload),
        },
    ]


def chat_messages(payload: Dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are ORION AI, an autonomous Solana DeFi copilot reachable from Telegram. "
                "Answer conversationally, clearly, and briefly. "
                "You may explain strategy, balances, and recent actions, but do not pretend to have executed anything unless the payload says so."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(payload),
        },
    ]


@entrypoint
def entry(payload, context):
    mode = payload.get("mode", "chat")

    if mode == "decision":
        content = call_model(decision_messages(payload), temperature=0.1)
        return safe_parse_decision(content)

    if mode == "chat":
        content = call_model(chat_messages(payload), temperature=0.4)
        return {"response": content}

    return {
        "response": f"Unsupported mode: {mode}",
        "trace_context": context,
    }
