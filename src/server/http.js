import http from "node:http";
import { OrionHarness } from "../cli/runtime.js";

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function textResponse(res, status, text) {
  const body = String(text || "");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function wantsText(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("text/plain");
}

function withCapturedOutput(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  const lines = [];

  const capture = (value) => {
    const text = typeof value === "string" ? value : String(value);
    if (text.trim()) {
      lines.push(text);
    }
  };

  console.log = (...args) => capture(args.map(String).join(" "));
  console.error = (...args) => capture(args.map(String).join(" "));
  console.warn = (...args) => capture(args.map(String).join(" "));
  process.stdout.write = (chunk, encoding, callback) => {
    capture(chunk);
    if (typeof callback === "function") callback();
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    capture(chunk);
    if (typeof callback === "function") callback();
    return true;
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      process.stdout.write = originalWrite;
      process.stderr.write = originalErrWrite;
    })
    .then((result) => ({ result, lines }));
}

function lastAssistantMessage(session) {
  const history = Array.isArray(session?.state?.history) ? session.state.history : [];
  const assistant = [...history].reverse().find((entry) => entry?.role === "assistant" && String(entry.content || "").trim());
  return assistant ? String(assistant.content) : "";
}

export async function runHttpServer({ port = Number(process.env.ORION_PORT) || 8787 } = {}) {
  const harness = await OrionHarness.create();
  const boot = await harness.boot().catch(() => null);
  const state = {
    queue: Promise.resolve(),
    closing: false
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return jsonResponse(res, 200, {
        ok: true,
        mode: "http",
        model: harness.session.state.model || "default",
        network: harness.session.state.network,
        rpcUrl: harness.session.state.rpcUrl
      });
    }

    if (req.method === "POST" && url.pathname === "/ask") {
      state.queue = state.queue.then(async () => {
        const raw = await readBody(req);
        let payload = {};
        if (raw.trim()) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = { prompt: raw.trim() };
          }
        }

        const prompt = String(payload.prompt || "").trim();
        if (!prompt) {
          return { status: 400, body: { error: "Missing prompt." } };
        }

        const previousLength = Array.isArray(harness.session.state.history)
          ? harness.session.state.history.length
          : 0;

        const { lines } = await withCapturedOutput(() => harness.executePrompt(prompt));
        const response = lastAssistantMessage(harness.session);
        const history = harness.session.state.history || [];
        const added = history.slice(previousLength);

        return {
          status: 200,
          body: {
            prompt,
            response,
            network: harness.session.state.network,
            model: harness.session.state.model || "default",
            boot,
            history: added,
            output: lines.join("")
          }
        };
      }).catch((error) => ({
        status: 500,
        body: { error: error.message || String(error) }
      }));

      state.queue
        .then(({ status, body }) => {
          if (wantsText(req)) {
            return textResponse(res, status, body.response || body.error || "");
          }
          return jsonResponse(res, status, body);
        })
        .catch((error) => {
          jsonResponse(res, 500, { error: error.message || String(error) });
        });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      return jsonResponse(res, 200, {
        name: "Orion",
        mode: "http",
        endpoints: ["/health", "/ask"],
        example: {
          method: "POST",
          path: "/ask",
          body: { prompt: "tell me about this wallet 7jysTypkmEDg5CXXWuPaAcytWC5UxWUCmj9NUJb1NetG" }
        }
      });
    }

    jsonResponse(res, 404, { error: "Not found" });
  });

  await new Promise((resolve) => {
    server.listen(port, resolve);
  });

  const shutdown = async () => {
    if (state.closing) return;
    state.closing = true;
    await new Promise((resolve) => server.close(resolve));
    await harness.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return {
    port,
    close: shutdown
  };
}
