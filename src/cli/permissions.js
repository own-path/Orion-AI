export async function confirmAction(rl, prompt) {
  const answer = await rl.question(`${prompt} [y/N] `);
  return answer.trim().toLowerCase() === "y";
}

export function assertNonMainnet(session, action = "This action") {
  if (String(session.state.network || "").includes("mainnet")) {
    throw new Error(`${action} is disabled on mainnet.`);
  }
}
