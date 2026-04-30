import path from "node:path";
import { execSync } from "node:child_process";
import { accent, buildLaunchSplash, danger, muted, success } from "./theme.js";
import { C, paint, panel, rule, headerStrip, BOLD } from "./ui.js";

function shortPath(p, maxParts = 2) {
  if (!p) return "";
  const parts = p.split(path.sep).filter(Boolean);
  if (parts.length <= maxParts) return p;
  return "../" + parts.slice(-maxParts).join("/");
}

function gitBranch(cwd) {
  try {
    return execSync("git branch --show-current", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 200
    }).trim() || null;
  } catch {
    return null;
  }
}

function normalizeTerminalLine(line) {
  const stripped = String(line)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/g, "");

  if (/^\s*[\*\-\+]\s+/.test(stripped)) {
    return stripped.replace(/^\s*[\*\-\+]\s+/, "• ");
  }

  return stripped;
}

export function printHeaderStrip(opts) {
  console.log(buildHeaderStrip(opts));
}

function buildHeaderStrip({ workspace, model, ollamaBaseUrl, network, currentWallet }) {
  const ws = shortPath(workspace, 2);
  const branch = gitBranch(workspace);
  const dot = paint("·", C.border);
  const wallet = currentWallet ? currentWallet.slice(0, 4) : null;
  const isCloud = /ollama\.com|ollama\.ai/.test(ollamaBaseUrl || "");
  const costTag = isCloud ? paint("$Cloud", C.success) : paint("$Free", C.success);

  const leftParts = [
    paint("orion", BOLD + C.primary),
    paint(ws, C.muted),
    branch ? paint(`(${branch})`, C.muted) : null,
    paint(network, C.accent),
    wallet ? paint(wallet, C.success) : paint("no-wallet", C.border)
  ].filter(Boolean);
  const left = leftParts.join(` ${dot} `);

  const right = `${paint(model, C.warning)}  ${costTag}`;

  return headerStrip({ left, right });
}

export function renderBootLines({ workspace, rpcUrl, model, ollamaAvailable, commandCount, toolCount, queuedTaskCount, watchTaskCount }) {
  const dot = paint("·", C.border);
  const ws = shortPath(workspace, 2);
  const net = (rpcUrl || "").replace(/^https?:\/\//, "").split("/")[0];
  return [
    `${paint("workspace", C.muted)}  ${ws}  ${dot}  ${paint("rpc", C.muted)} ${net}`,
    `${paint("ollama   ", C.muted)}  ${ollamaAvailable ? success("● ready") : danger("○ offline")}  ${dot}  ${paint("model", C.muted)} ${paint(model, C.accent)}`,
    `${paint("queue    ", C.muted)}  ${queuedTaskCount} queued  ${dot}  ${watchTaskCount} watching  ${dot}  ${commandCount} cmds  ${dot}  ${toolCount} tools`
  ];
}

export function printBanner(opts = {}) {
  console.log(buildLaunchSplash(opts));
}

export function printLaunchSummary({ boot, session } = {}) {
  const network = session?.network || "devnet";
  const wallet = session?.currentWallet || "none selected";
  const strategy = session?.currentStrategy || "balanced";
  const model = boot?.model || session?.model || "default";
  const status = boot?.ollamaAvailable ? "online" : "offline";
  const source = boot?.ollamaRemote ? "$Cloud" : "$Local";
  console.log(`${paint("orion", BOLD + C.primary)} ${paint("·", C.border)} ${paint(network, C.accent)} ${paint("·", C.border)} ${paint(wallet, C.success)} ${paint("·", C.border)} ${paint(strategy, C.warning)}    ${paint(model, C.warning)}  ${paint(status, boot?.ollamaAvailable ? C.success : C.danger)}  ${paint(source, boot?.ollamaRemote ? C.success : C.muted)}`);
  console.log(rule(C.border));
}

export function printPanel(title, lines) {
  console.log(panel(title, lines));
}

export function printNotice(text) {
  console.log(`${paint("•", C.border)} ${muted(text)}`);
}

export function printStep(step, text) {
  console.log(`${paint("•", C.primary)} ${paint(step, C.secondary)} ${muted(text)}`);
}

export function printPlan(title, summary, steps = []) {
  const lines = [
    normalizeTerminalLine(title),
    normalizeTerminalLine(summary),
    "",
    ...steps.map((step, index) => `${index + 1}. ${normalizeTerminalLine(step.title)} — ${normalizeTerminalLine(step.goal)}`)
  ].filter(Boolean);
  printPanel("Plan", lines);
}

export function printError(error) {
  console.error(`${paint("✗", C.danger)} ${danger(error.message)}`);
}

export function printUserEcho(text) {
  const lines = String(text).split("\n");
  console.log(`${paint("│", C.border)} ${muted(lines[0] || "")}`);
  if (lines.length > 1) {
    console.log("");
  }
  for (const line of lines.slice(1)) {
    console.log(`  ${muted(line)}`);
  }
}

export function printAssistant(text, { model, elapsedMs } = {}) {
  const lines = String(text)
    .split("\n")
    .map(normalizeTerminalLine);
  console.log("");
  for (const line of lines) {
    if (line.trim().length === 0) {
      console.log("");
    } else {
      console.log(`   ${line}`);
    }
  }
  if (model) {
    const seconds = elapsedMs != null ? `  ${paint("·", C.border)}  ${paint(`${(elapsedMs / 1000).toFixed(1)}s`, C.muted)}` : "";
    console.log(`\n  ${paint("▣", C.secondary)} ${paint(model, C.warning)}${seconds}`);
  }
}

export function printSummary(label, value) {
  console.log(`${accent(label)} ${normalizeTerminalLine(value)}`);
}

export function printRule(color = C.border, label) {
  console.log(rule(color, label));
}

export function printPreflightWarning(boot) {
  if (!boot) return;
  const tag = paint("!", C.warning);
  if (boot.ollamaMissingKey) {
    console.log("");
    console.log(`${tag} ${paint("OLLAMA_API_KEY is empty — required for Ollama Cloud.", C.warning)}`);
    console.log(`  ${paint("→ create a key:", C.muted)} ${paint("https://ollama.com/settings/keys", C.accent)}`);
    console.log(`  ${paint("→ paste into", C.muted)} ${paint(".env", C.accent)} ${paint("as", C.muted)} ${paint("OLLAMA_API_KEY=…", C.accent)}`);
    return;
  }
  if (boot.ollamaAuthFailed) {
    console.log("");
    console.log(`${tag} ${paint("Ollama Cloud rejected the API key (401).", C.warning)}`);
    console.log(`  ${paint("→ get a key:", C.muted)} ${paint("https://ollama.com/settings/keys", C.accent)}`);
    console.log(`  ${paint("→ paste it into", C.muted)} ${paint(".env", C.accent)} ${paint("as", C.muted)} ${paint("OLLAMA_API_KEY=…", C.accent)}`);
    return;
  }
  if (!boot.ollamaAvailable) {
    console.log("");
    if (boot.ollamaRemote) {
      console.log(`${tag} ${paint("Cannot reach Ollama Cloud.", C.warning)}`);
      console.log(`  ${paint("→ check network and", C.muted)} ${paint("OLLAMA_BASE_URL", C.accent)} ${paint("in .env", C.muted)}`);
    } else {
      console.log(`${tag} ${paint("Ollama daemon not reachable.", C.warning)}`);
      console.log(`  ${paint("→ start it:", C.muted)} ${paint("ollama serve", C.accent)}`);
    }
    return;
  }
  if (!boot.modelAvailable) {
    console.log("");
    console.log(`${tag} ${paint(`Model '${boot.model}' not found locally.`, C.warning)}`);
    console.log(`  ${paint("→ pull it:", C.muted)} ${paint(`ollama pull ${boot.model}`, C.accent)}`);
    if (boot.installedModels?.length) {
      console.log(`  ${paint("installed:", C.muted)} ${boot.installedModels.join(", ")}`);
    }
  }
}
