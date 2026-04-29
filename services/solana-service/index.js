import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { config } from "../shared/config.js";
import { getStrategyConfig } from "../shared/strategies.js";

export class SolanaService {
  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, "confirmed");
  }

  async createWallet() {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: JSON.stringify(Array.from(keypair.secretKey))
    };
  }

  async getPortfolioState(walletAddress, strategy = "balanced") {
    const balanceLamports = await this.connection.getBalance(new PublicKey(walletAddress));
    const solBalance = balanceLamports / 1_000_000_000;
    const solReferencePrice = 150;
    const strategyConfig = getStrategyConfig(strategy);
    const maxAllocatableSol = Number((solBalance * strategyConfig.allocationPct).toFixed(4));

    return {
      walletAddress,
      network: config.solanaNetwork,
      solBalance,
      estimatedUsdValue: Number((solBalance * solReferencePrice).toFixed(2)),
      maxAllocatableSol,
      tokens: []
    };
  }

  async executeAutonomousAction({ user, decision }) {
    if (decision.action === "hold") {
      return {
        status: "held",
        signature: null
      };
    }

    if (config.solanaExecutionMode !== "mock") {
      throw new Error(
        "This MVP supports real wallet creation and balance tracking, but autonomous stake/swap execution is mock-only."
      );
    }

    const signature = `mock-${decision.action}-${user.userId}-${Date.now()}`;

    return {
      status: "executed_mock",
      signature
    };
  }
}
