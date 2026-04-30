import path from "node:path";
import { stdout } from "node:process";
import { execSync } from "node:child_process";

const RESET = "[0m";
const BOLD = "[1m";
const DIM = "[2m";
const HIDE_CURSOR = "[?25l";
const SHOW_CURSOR = "[?25h";
const CLEAR_LINE = "\r[2K";

const C = {
  primary:   "[38;5;141m",
  secondary: "[38;5;213m",
  accent:    "[38;5;51m",
  success:   "[38;5;84m",
  warning:   "[38;5;221m",
  danger:    "[38;5;203m",
  border:    "[38;5;240m",
  muted:     "[38;5;244m"
};

function paint(text, code) {
  return `${code}${text}${RESET}`;
}

function termCols() {
  return Math.max(40, stdout.columns || 80);
}

function rule(color = C.border, label) {
  const cols = termCols();
  if (!label) {
    return paint("─".repeat(cols), color);
  }
  const tag = ` · ${label} `;
  const line = "─".repeat(Math.max(0, cols - tag.length));
  return paint(line, color) + paint(tag, color);
}

const KEYBIND_BAR =
  "[/help] commands  [tab] complete  [↑↓] history  [esc] cancel  [@] reference";

const TIPS = [
  "tip — type / to browse commands with descriptions",
  "tip — /tasks lists durable background work",
  "tip — /resume <id> picks up a paused task",
  "tip — /cluster devnet|testnet|mainnet switches network presets",
  "tip — /strategy conservative|balanced|aggressive shapes risk",
  "tip — describe a goal in plain english; the harness plans tools",
  "tip — long-running watches survive restart"
];

function currentHint() {
  return KEYBIND_BAR;
}

function hintBar(text = currentHint()) {
  const cols = termCols();
  const trimmed = text.length > cols - 2 ? text.slice(0, cols - 2) : text;
  return paint(trimmed, C.muted);
}

function modeColor(network) {
  if (!network) return C.border;
  const n = String(network).toLowerCase();
  if (n.includes("mainnet")) return C.warning;
  if (n.includes("testnet")) return C.accent;
  if (n.includes("devnet"))  return C.primary;
  return C.border;
}

function modeLabel(session) {
  const net = session?.network || "local";
  return net;
}

function estimateTokens(history = []) {
  return history.reduce((sum, entry) => sum + Math.max(1, Math.ceil(String(entry?.content || "").length / 4)), 0);
}

function contextWindowForModel(model = "") {
  const name = String(model).toLowerCase();
  if (name.includes("gemma4")) {
    if (name.includes("e2b") || name.includes("e4b")) return 128_000;
    return 256_000;
  }
  return 10_000;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const THINK_WORDS = [
  "thinking", "planning", "routing", "checking", "fetching",
  "synthesizing", "computing", "weighing", "reasoning"
];

function startSpinner({ initialWord = "thinking", message } = {}) {
  let frame = 0;
  let wordIdx = THINK_WORDS.indexOf(initialWord);
  if (wordIdx < 0) wordIdx = 0;
  let ticks = 0;
  const label = message ? String(message).trim() : null;

  stdout.write(HIDE_CURSOR);
  const render = () => {
    const glyph = paint(SPINNER_FRAMES[frame % SPINNER_FRAMES.length], C.primary);
    const word  = label
      ? paint(`${label}…`, C.muted)
      : paint(`${THINK_WORDS[wordIdx]}…`, C.muted);
    stdout.write(`${CLEAR_LINE}  ${glyph} ${word}`);
    frame += 1;
    ticks += 1;
    if (ticks % 22 === 0) {
      wordIdx = (wordIdx + 1) % THINK_WORDS.length;
    }
  };
  render();
  const id = setInterval(render, 80);

  return () => {
    clearInterval(id);
    stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  };
}

async function withSpinner(fn, opts) {
  const stop = startSpinner(opts);
  try {
    return await fn();
  } finally {
    stop();
  }
}

function shortPath(p, maxParts = 2) {
  if (!p) return "";
  const parts = String(p).split(path.sep).filter(Boolean);
  if (parts.length <= maxParts) return p;
  return `../${parts.slice(-maxParts).join("/")}`;
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

function turnHeader(session) {
  const cwd = shortPath(session?.workspace || process.cwd(), 2);
  const model = session?.model || "default";
  const contextWindow = contextWindowForModel(model);
  const usedTokens = estimateTokens(session?.history || []);
  const pct = Math.max(5, Math.min(95, Math.round((usedTokens / Math.max(1, contextWindow)) * 100)));
  const blocks = Math.max(1, Math.min(8, Math.round((pct / 100) * 8)));
  const bar = `${"░".repeat(8 - blocks)}${"█".repeat(blocks)}`;
  const cost = "$Free";
  const leftParts = [
    paint("orion", BOLD + C.primary),
    paint(cwd, C.muted),
    paint("◉◉", C.success),
  ].filter(Boolean);
  const right = [
    paint(model, C.warning),
    paint(bar, C.border),
    paint(`${pct}%`, C.success),
    paint(`${(contextWindow / 1000).toFixed(1)}k`, C.muted),
    paint(cost, C.success)
  ].join("  ");
  return headerStrip({
    left: leftParts.join(" "),
    right
  });
}

function turnFooter() {
  return rule(C.border);
}

function promptMarker() {
  return ` ${BOLD}${C.primary}❯${RESET} `;
}

function promptRule() {
  const cols = termCols();
  const label = " · general ";
  const line = "─".repeat(Math.max(0, cols - label.length));
  return paint(line, C.border) + paint(label, C.border);
}

// Two-segment header strip: left context, right model + cost.
// Caps the gap between segments at MAX_GAP so the right side floats near the
// left rather than slamming the terminal edge on wide screens. Truncates the
// left segment if cols are too narrow to fit both.
function headerStrip({ left, right }) {
  const cols = termCols();
  const leftVisible = stripAnsi(left);
  const rightVisible = stripAnsi(right);
  const total = leftVisible.length + rightVisible.length;

  let leftRendered = left;
  let leftLen = leftVisible.length;
  if (total + 2 > cols) {
    const room = Math.max(0, cols - rightVisible.length - 2);
    const truncated = leftVisible.slice(0, Math.max(0, room - 1)) + "…";
    leftRendered = paint(truncated, C.muted);
    leftLen = truncated.length;
  }
  const gap = " ".repeat(Math.max(2, cols - leftLen - rightVisible.length - 1));
  return ` ${leftRendered}${gap}${right}`;
}

function turnFooterHint() {
  return ` ${hintBar()}`;
}

function stripAnsi(s) {
  return String(s).replace(/\[[0-9;]*m/g, "");
}

function simplePanel(title, lines, innerWidth) {
  const cols = termCols();
  const visibleLines = lines.map((l) => String(l));
  const width = innerWidth ?? Math.min(
    cols - 2,
    Math.max(title.length + 4, ...visibleLines.map((l) => stripAnsi(l).length)) + 2
  );

  const titleStr = ` ${title} `;
  const titleVisible = stripAnsi(titleStr).length;
  const topFill = "─".repeat(Math.max(0, width - titleVisible - 2));
  const top = paint("╭─", C.border) + paint(titleStr, BOLD + C.primary) + paint(topFill + "╮", C.border);

  const body = visibleLines.map((line) => {
    const visible = stripAnsi(line);
    const pad = " ".repeat(Math.max(0, width - visible.length - 2));
    return paint("│ ", C.border) + line + pad + paint(" │", C.border);
  });

  const bottom = paint("╰" + "─".repeat(width) + "╯", C.border);
  return [top, ...body, bottom].join("\n");
}

export {
  C,
  RESET,
  BOLD,
  DIM,
  paint,
  rule,
  hintBar,
  KEYBIND_BAR,
  modeColor,
  modeLabel,
  startSpinner,
  withSpinner,
  turnHeader,
  turnFooter,
  promptRule,
  turnFooterHint,
  promptMarker,
  headerStrip,
  simplePanel as panel,
  termCols,
  stripAnsi
};
