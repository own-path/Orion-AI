export const STRATEGIES = {
  conservative: {
    name: "Conservative",
    allocationPct: 0.15,
    riskTolerance: 0.2,
    executionSensitivity: 0.85
  },
  balanced: {
    name: "Balanced",
    allocationPct: 0.3,
    riskTolerance: 0.5,
    executionSensitivity: 0.6
  },
  aggressive: {
    name: "Aggressive",
    allocationPct: 0.5,
    riskTolerance: 0.8,
    executionSensitivity: 0.35
  }
};

export function normalizeStrategy(input) {
  const key = String(input || "").trim().toLowerCase();
  return STRATEGIES[key] ? key : null;
}

export function getStrategyConfig(strategy = "balanced") {
  return STRATEGIES[strategy] || STRATEGIES.balanced;
}
