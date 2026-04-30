const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const PURPLE = "\u001b[38;5;141m";
const GREEN = "\u001b[38;5;84m";
const CYAN = "\u001b[38;5;51m";
const GOLD = "\u001b[38;5;221m";
const RED = "\u001b[38;5;203m";

function color(text, code) {
  return `${code}${text}${RESET}`;
}

function paint(text, code) {
  return color(text, code);
}

export function accent(text) {
  return color(text, PURPLE);
}

export function success(text) {
  return color(text, GREEN);
}

export function info(text) {
  return color(text, CYAN);
}

export function warn(text) {
  return color(text, GOLD);
}

export function danger(text) {
  return color(text, RED);
}

export function muted(text) {
  return color(text, DIM);
}

export function strong(text) {
  return color(text, BOLD);
}

const ORION_WORDMARK = [
  " ██████  ██████╗ ██╗ ██████╗ ███╗   ██╗",
  "██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║",
  "██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║",
  "██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║",
  "╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║",
  " ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝"
];

const STARTER_HIGHLIGHTS = [
  "plain text prompts are planned first",
  "live Solana data keeps answers grounded",
  "long-horizon tasks come back with a report"
];

function termCols() {
  return Math.max(40, process.stdout.columns || 80);
}

function shortPath(p, maxParts = 2) {
  if (!p) return "";
  const parts = String(p).split("/").filter(Boolean);
  if (parts.length <= maxParts) return p;
  return `../${parts.slice(-maxParts).join("/")}`;
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "");
}

function centerLine(visibleLine, paint) {
  const cols = termCols();
  const plain = stripAnsi(visibleLine);
  const pad = Math.max(0, Math.floor((cols - plain.length) / 2));
  return " ".repeat(pad) + paint(visibleLine);
}

function fitLine(text, width) {
  const plain = stripAnsi(text);
  if (plain.length <= width) {
    return text + " ".repeat(Math.max(0, width - plain.length));
  }
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function formatTask(task) {
  const created = task?.updatedAt || task?.createdAt;
  const age = created ? timeAgo(created) : "now";
  const label = task?.title || task?.target || task?.prompt || task?.type || "task";
  return `${age} · ${label}`;
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function buildColumns(leftTitle, leftRows, rightTitle, rightRows) {
  const cols = termCols();
  const innerWidth = Math.min(Math.max(56, cols - 8), 94);
  const gap = 6;
  const leftWidth = Math.floor((innerWidth - gap) / 2);
  const rightWidth = innerWidth - leftWidth - gap;
  const pad = Math.max(0, Math.floor((cols - innerWidth) / 2));
  const indent = " ".repeat(pad);
  const maxRows = Math.max(leftRows.length, rightRows.length);
  const lines = [];

  lines.push(
    `${indent}${strong(leftTitle.padEnd(leftWidth))}${" ".repeat(gap)}${strong(rightTitle.padEnd(rightWidth))}`
  );

  for (let i = 0; i < maxRows; i += 1) {
    const left = fitLine(leftRows[i] || "", leftWidth);
    const right = fitLine(rightRows[i] || "", rightWidth);
    lines.push(`${indent}${muted(left)}${" ".repeat(gap)}${muted(right)}`);
  }

  return lines.join("\n");
}

export function buildBanner() {
  const logoWidth = Math.max(...ORION_WORDMARK.map((l) => l.length));
  const cols = termCols();
  const pad = Math.max(0, Math.floor((cols - logoWidth) / 2));
  const padStr = " ".repeat(pad);
  const logo = ORION_WORDMARK.map((line) => `${padStr}${accent(line)}`).join("\n");
  return logo;
}

export function buildLaunchSplash({ session, boot, recentTasks = [] } = {}) {
  const cols = termCols();
  const logo = buildBanner();
  const divider = paint("─".repeat(cols), DIM);
  const status = recentTasks.length ? recentTasks.slice(0, 1).map(formatTask)[0] : "ready";
  void boot;
  void session;
  return `${logo}\n${divider}\n${centerLine(status, (t) => `${muted(t)}`)}`;
}

export function renderPanel(title, lines) {
  const width = Math.max(title.length + 4, ...lines.map((line) => String(line).length)) + 2;
  const top = `${accent("+")}${"-".repeat(width)}${accent("+")}`;
  const header = `${accent("|")} ${strong(title.padEnd(width - 2))} ${accent("|")}`;
  const body = lines.map((line) => `${accent("|")} ${String(line).padEnd(width - 2)} ${accent("|")}`);
  return [top, header, top, ...body, top].join("\n");
}

export function buildPrompt(session) {
  const networkColor = session.network.includes("mainnet") ? warn : info;
  const wallet = session.currentWallet ? session.currentWallet.slice(0, 4) : "none";
  return `${accent("orion")}[${networkColor(session.network)}][${success(wallet)}]> `;
}
