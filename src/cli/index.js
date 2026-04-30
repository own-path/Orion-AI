import { OrionHarness } from "./runtime.js";
import { runOnboarding } from "./onboarding.js";
import { printBanner, printPreflightWarning } from "./renderer.js";
import { runHttpServer } from "../server/http.js";

function wantsHttpMode(argv = process.argv) {
  return argv.includes("--serve") || argv.includes("serve");
}

export async function runCli(argv = process.argv) {
  if (wantsHttpMode(argv)) {
    const server = await runHttpServer();
    console.log(`Orion HTTP server listening on http://127.0.0.1:${server.port}`);
    return;
  }

  const harness = await OrionHarness.create();
  const recentTasks = await harness.listTasks().catch(() => []);

  printBanner({
    session: harness.session.state,
    boot: null,
    recentTasks
  });

  if (!harness.session.state.onboardingDone) {
    await runOnboarding(harness.context());
  }

  const boot = await harness.boot();

  printPreflightWarning(boot);

  try {
    await harness.loop();
  } finally {
    await harness.close();
  }
}
