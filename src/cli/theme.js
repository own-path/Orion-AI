const RESET = "[0m";
const BOLD = "[1m";
const DIM = "[2m";
const PURPLE = "[38;5;141m";
const GREEN = "[38;5;84m";
const CYAN = "[38;5;51m";
const GOLD = "[38;5;221m";
const RED = "[38;5;203m";

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

const ORION_WORDMARK = [
  " ██████  ██████╗ ██╗ ██████╗ ███╗   ██╗",
  "██╔═══██╗██╔══██╗██║██╔═══██╗████╗  ██║",
  "██║   ██║██████╔╝██║██║   ██║██╔██╗ ██║",
  "██║   ██║██╔══██╗██║██║   ██║██║╚██╗██║",
  "╚██████╔╝██║  ██║██║╚██████╔╝██║ ╚████║",
  " ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝"
];

function termCols() {
  return Math.max(40, process.stdout.columns || 80);
}

export function buildLaunchSplash({ session } = {}) {
  const cols = termCols();

  const logoWidth = Math.max(...ORION_WORDMARK.map((l) => l.length));
  const logoPad = Math.max(0, Math.floor((cols - logoWidth) / 2));
  const logoPadStr = " ".repeat(logoPad);
  const logo = ORION_WORDMARK.map((line) => `${logoPadStr}${accent(line)}`).join("\n");

  const underline = `${logoPadStr}${paint("▀".repeat(logoWidth), DIM)}`;

  const model = session?.model || "orion";
  const subtitlePlain = `v0.1.0  ·  ${model}`;
  const subtitlePad = " ".repeat(Math.max(0, Math.floor((cols - subtitlePlain.length) / 2)));
  const subtitleLine = `${subtitlePad}${muted("v0.1.0")}  ${paint("·", DIM)}  ${paint(model, GOLD)}`;

  const divider = paint("─".repeat(cols), DIM);

  return [logo, underline, subtitleLine, divider].join("\n");
}
