import { OrionHarness } from "./runtime.js";
import { runOnboarding } from "./onboarding.js";
import { printBanner, printPreflightWarning } from "./renderer.js";

export async function runCli() {
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
