import os from "node:os";
import { config } from "../../services/shared/config.js";
import { accent, buildLaunchSplash, danger, muted } from "./theme.js";
import { C, paint, panel, rule, BOLD, termCols, stripAnsi } from "./ui.js";

function configFileLabel() {
  return config.persistentConfigFilePath.replace(os.homedir(), "~");
}

function normalizeTerminalLine(line) {
  if (line && typeof line === "object") {
    return JSON.stringify(line);
  }
  const stripped = String(line)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/g, "")
    .replace(/^---+$/, "");

  if (/^\s*[\*\-\+]\s+/.test(stripped)) {
    return stripped.replace(/^\s*[\*\-\+]\s+/, "· ");
  }

  return stripped;
}

export function printBanner(opts = {}) {
  console.log(buildLaunchSplash(opts));
}

export function printPanel(title, lines) {
  console.log(panel(title, lines));
}

export function printNotice(text) {
  console.log(`${paint("•", C.border)} ${muted(text)}`);
}

export function printStep(step, text) {
  console.log(`${paint("⏺", BOLD + C.primary)} ${paint(text, C.primary)}  ${paint(`[${step}]`, C.accent)}`);
}

export function printStepDetail(...lines) {
  const toText = (value) => {
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value);
  };
  const [first, ...rest] = lines.flatMap(l => toText(l).split("\n")).filter(l => l.trim());
  if (!first) return;
  console.log(`  ${paint("⎿", C.border)}  ${muted(first)}`);
  for (const l of rest) console.log(`     ${muted(l)}`);
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
  console.log(`${paint("❯", BOLD + C.primary)} ${paint(lines[0] || "", C.muted)}`);
  for (const line of lines.slice(1)) {
    console.log(`  ${paint(line, C.muted)}`);
  }
}

function detectValueColor(value) {
  const v = String(value).toLowerCase();
  if (/\b(low|safe|good|healthy|ok|success)\b/.test(v)) return C.success;
  if (/\b(medium|moderate|warning|caution)\b/.test(v)) return C.warning;
  if (/\b(high|critical|danger|error|fail)\b/.test(v)) return C.danger;
  return C.primary;
}

function parseKvLine(line) {
  const cleaned = String(line)
    .replace(/^\s*[•·\-\*]+\s*/, "")
    .trim();
  const idx = cleaned.indexOf(":");
  if (idx <= 0) {
    return null;
  }
  const key = cleaned.slice(0, idx).trim();
  const value = cleaned.slice(idx + 1).trim();
  if (!key || !value) {
    return null;
  }
  return { key, value };
}

function isKvBlock(lines) {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length < 2) return false;
  const kvCount = nonEmpty.filter((line) => Boolean(parseKvLine(line))).length;
  return kvCount / nonEmpty.length >= 0.6;
}

export function printSummaryPanel(title, kvPairs, { model, elapsedMs } = {}) {
  const cols = termCols();

  const maxKeyLen = Math.max(0, ...kvPairs.map(p => String(p.key).length));
  const maxValLen = Math.max(0, ...kvPairs.map(p => String(p.value).length));
  const keyColW = maxKeyLen + 2;
  const contentW = Math.min(cols - 6, Math.max(keyColW + maxValLen + 2, 44));
  const valColW = contentW - keyColW;

  const headerText = `⬡ [ ${title.toUpperCase()} ]`;
  const headerPad = " ".repeat(Math.max(0, contentW - headerText.length));
  const top = `${paint("┃", C.warning)} ${paint(headerText, BOLD + C.warning)}${headerPad}`;
  const divider = `${paint("┃", C.warning)} ${"─".repeat(contentW)}`;

  const rows = kvPairs.map(({ key, value }) => {
    const keyStr = String(key).padEnd(keyColW);
    const valStr = String(value);
    const valFit = valStr.length > valColW ? valStr.slice(0, valColW - 1) + "…" : valStr;
    const valPad = " ".repeat(Math.max(0, valColW - valFit.length));
    return `${paint("┃", C.warning)} ${paint(keyStr, C.muted)}${paint(valPad + valFit, detectValueColor(value))}`;
  });

  console.log("");
  console.log(top);
  console.log(divider);
  for (const row of rows) console.log(row);
  if (model) {
    const seconds = elapsedMs != null ? `  ${paint("·", C.border)}  ${paint(`${(elapsedMs / 1000).toFixed(1)}s`, C.muted)}` : "";
    console.log(`\n  ${paint("▣", C.secondary)} ${paint(model, C.warning)}${seconds}`);
  }
}

export function printAssistant(text, { model, elapsedMs, compact = false } = {}) {
  const lines = String(text)
    .split("\n")
    .map(normalizeTerminalLine);

  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (isKvBlock(nonEmpty)) {
    const kvPairs = nonEmpty.map(parseKvLine).filter(Boolean);
    printSummaryPanel("Summary", kvPairs, { model, elapsedMs });
    return;
  }

  console.log("");
  const displayLines = compact && lines.length > 5
    ? [...lines.slice(0, 4), "…"]
    : lines;
  for (const line of displayLines) {
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
    console.log(`  ${paint("→ Orion stores it in", C.muted)} ${paint(configFileLabel(), C.accent)} ${paint("as", C.muted)} ${paint("OLLAMA_API_KEY=…", C.accent)}`);
    return;
  }
  if (boot.ollamaAuthFailed) {
    console.log("");
    console.log(`${tag} ${paint("Ollama Cloud rejected the API key (401).", C.warning)}`);
    console.log(`  ${paint("→ get a key:", C.muted)} ${paint("https://ollama.com/settings/keys", C.accent)}`);
    console.log(`  ${paint("→ update", C.muted)} ${paint(configFileLabel(), C.accent)} ${paint("with", C.muted)} ${paint("OLLAMA_API_KEY=…", C.accent)}`);
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
