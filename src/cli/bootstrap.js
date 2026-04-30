import { config } from "../../services/shared/config.js";

export async function buildBootstrap({ session, ollama, solana, commandRegistry, toolRegistry, taskStore }) {
  const health = await ollama.checkHealth();
  const isRemote = /^https?:\/\/(?!(127\.0\.0\.1|localhost))/i.test(config.ollamaBaseUrl);
  const missingKey = isRemote && !config.ollamaApiKey;
  const tasks = taskStore ? await taskStore.list() : [];
  const model = session.state.model || "default";
  // For remote Ollama Cloud, /api/tags doesn't list cloud models — assume the
  // configured model is available if auth succeeded. Only check the list when
  // talking to a local daemon.
  const modelAvailable = health.remote
    ? health.available
    : health.available && health.models.some(
        (name) => name === model || name.split(":")[0] === model.split(":")[0]
      );
  const solscanChainInfo = solana?.getChainInfo
    ? await solana.getChainInfo().catch(() => null)
    : null;
  return {
    workspace: session.state.workspace,
    rpcUrl: session.state.rpcUrl,
    model,
    solscanChainInfo,
    ollamaAvailable: health.available,
    ollamaRemote: health.remote || isRemote,
    ollamaMissingKey: missingKey,
    ollamaAuthFailed: Boolean(health.authFailed),
    modelAvailable,
    installedModels: health.models,
    harnessMode: "langgraph",
    toolCalling: true,
    longRunningTasks: true,
    queuedTaskCount: tasks.filter((task) => task.status === "queued").length,
    watchTaskCount: tasks.filter((task) => task.type === "watch" && task.status !== "cancelled").length,
    commandCount: commandRegistry.size,
    toolCount: toolRegistry.size
  };
}
