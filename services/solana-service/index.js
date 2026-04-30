import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { config } from "../shared/config.js";
import { getStrategyConfig } from "../shared/strategies.js";

function normalizeAccountInfo(accountInfo) {
  return {
    executable: accountInfo.executable,
    owner: accountInfo.owner.toBase58(),
    lamports: accountInfo.lamports,
    dataLength: accountInfo.data.length,
    rentEpoch: accountInfo.rentEpoch
  };
}

export class SolanaService {
  constructor({ rpcUrl = config.solanaRpcUrl, network = config.solanaNetwork } = {}) {
    this.rpcUrl = rpcUrl;
    this.network = network;
    this.connection = new Connection(this.rpcUrl, "confirmed");
    this.solscanBaseUrl = config.solscanBaseUrl;
    this.solscanApiKey = config.solscanApiKey;
  }

  setRpcUrl(rpcUrl, network = this.network) {
    this.rpcUrl = rpcUrl;
    this.network = network;
    this.connection = new Connection(this.rpcUrl, "confirmed");
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
      network: this.network,
      solBalance,
      estimatedUsdValue: Number((solBalance * solReferencePrice).toFixed(2)),
      maxAllocatableSol,
      tokens: []
    };
  }

  async getWalletBalance(walletAddress) {
    const balanceLamports = await this.connection.getBalance(new PublicKey(walletAddress));
    return {
      walletAddress,
      network: this.network,
      solBalance: balanceLamports / 1_000_000_000
    };
  }

  async getWalletBalanceAcrossClusters(walletAddress) {
    const current = await this.getWalletBalance(walletAddress).catch(() => null);
    if (current || this.network === "mainnet-beta") {
      return {
        sourceNetwork: this.network,
        balance: current
      };
    }

    const mainnet = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const balanceLamports = await mainnet.getBalance(new PublicKey(walletAddress)).catch(() => null);
    return {
      sourceNetwork: balanceLamports != null ? "mainnet-beta" : this.network,
      balance: balanceLamports == null
        ? null
        : {
            walletAddress,
            network: "mainnet-beta",
            solBalance: balanceLamports / 1_000_000_000
          }
    };
  }

  async getAccountInfo(address) {
    const publicKey = new PublicKey(address);
    const accountInfo = await this.connection.getAccountInfo(publicKey);
    if (!accountInfo) {
      return null;
    }

    return {
      address,
      ...normalizeAccountInfo(accountInfo)
    };
  }

  async getAccountInfoAcrossClusters(address) {
    const current = await this.getAccountInfo(address).catch(() => null);
    if (current || this.network === "mainnet-beta") {
      return {
        sourceNetwork: this.network,
        account: current
      };
    }

    const mainnet = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const accountInfo = await mainnet.getAccountInfo(new PublicKey(address)).catch(() => null);
    return {
      sourceNetwork: accountInfo ? "mainnet-beta" : this.network,
      account: accountInfo
        ? {
            address,
            ...normalizeAccountInfo(accountInfo)
          }
        : null
    };
  }

  async getRecentSignatures(address, limit = 10) {
    return this.connection.getSignaturesForAddress(new PublicKey(address), {
      limit: Math.max(1, Math.min(Number(limit) || 10, 25))
    });
  }

  async getRecentSignaturesAcrossClusters(address, limit = 10) {
    const current = await this.getRecentSignatures(address, limit).catch(() => []);
    if (current.length || this.network === "mainnet-beta") {
      return {
        sourceNetwork: this.network,
        signatures: current
      };
    }

    const mainnet = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const signatures = await mainnet.getSignaturesForAddress(new PublicKey(address), {
      limit: Math.max(1, Math.min(Number(limit) || 10, 25))
    }).catch(() => []);
    return {
      sourceNetwork: signatures.length ? "mainnet-beta" : this.network,
      signatures
    };
  }

  async getLookupSnapshot(address, { limit = 10 } = {}) {
    const [accountResult, balanceResult, signaturesResult] = await Promise.all([
      this.getAccountInfoAcrossClusters(address),
      this.getWalletBalanceAcrossClusters(address),
      this.getRecentSignaturesAcrossClusters(address, limit)
    ]);

    let balance = balanceResult.balance;
    if (accountResult.sourceNetwork === "mainnet-beta" && balance?.network !== "mainnet-beta") {
      const mainnet = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const balanceLamports = await mainnet.getBalance(new PublicKey(address)).catch(() => null);
      balance = balanceLamports == null
        ? balance
        : {
            walletAddress: address,
            network: "mainnet-beta",
            solBalance: balanceLamports / 1_000_000_000
          };
    }

    return {
      address,
      sourceNetwork:
        accountResult.sourceNetwork ||
        balanceResult.sourceNetwork ||
        signaturesResult.sourceNetwork ||
        this.network,
      account: accountResult.account,
      balance,
      recentSignatures: signaturesResult.signatures
    };
  }

  async getProgramAccounts(programId, { limit = 10 } = {}) {
    const accounts = await this.connection.getProgramAccounts(new PublicKey(programId));
    return accounts.slice(0, Math.max(1, Math.min(Number(limit) || 10, 25))).map(({ pubkey, account }) => ({
      pubkey: pubkey.toBase58(),
      ...normalizeAccountInfo(account)
    }));
  }

  async getRecentPrioritizationFees(addresses = []) {
    const keys = addresses.filter(Boolean).map((address) => new PublicKey(address));
    return this.connection.getRecentPrioritizationFees(keys);
  }

  async callRpcMethod(method, params = [], { commitment = "confirmed" } = {}) {
    const rpcParams = [...params];
    if (commitment) {
      const last = rpcParams[rpcParams.length - 1];
      if (last && typeof last === "object" && !Array.isArray(last)) {
        rpcParams[rpcParams.length - 1] = { ...last, commitment };
      } else {
        rpcParams.push({ commitment });
      }
    }

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `orion-${Date.now()}`,
        method,
        params: rpcParams
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      const error = payload?.error?.message || payload?.error?.data || `RPC request failed: ${response.status}`;
      throw new Error(Array.isArray(error) ? error.join(" ") : String(error));
    }

    return payload.result;
  }

  async getChainInfo() {
    const request = async (headers = {}) => {
      const response = await fetch("https://public-api.solscan.io/chaininfo", {
        headers: {
          accept: "application/json",
          ...headers
        }
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          payload
        };
      }

      return {
        ok: true,
        payload
      };
    };

    const publicResult = await request();
    if (publicResult.ok) {
      return publicResult.payload;
    }

    if (this.solscanApiKey) {
      const authedResult = await request({
        token: this.solscanApiKey,
        Authorization: `Bearer ${this.solscanApiKey}`,
        "X-API-KEY": this.solscanApiKey
      });
      if (authedResult.ok) {
        return authedResult.payload;
      }

      throw new Error(authedResult.payload?.message || `Solscan chaininfo request failed: ${authedResult.status}`);
    }

    throw new Error(publicResult.payload?.message || `Solscan chaininfo request failed: ${publicResult.status}`);
  }

  async solscanRequest(pathname, params = {}) {
    if (!this.solscanApiKey && config.solscanRequired) {
      throw new Error("SOLSCAN_API_KEY is not set.");
    }

    if (!this.solscanApiKey) {
      return null;
    }

    const url = new URL(pathname.replace(/^\/+/, ""), `${this.solscanBaseUrl.replace(/\/+$/, "")}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          token: this.solscanApiKey,
          Authorization: `Bearer ${this.solscanApiKey}`,
          "X-API-KEY": this.solscanApiKey
        },
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `Solscan request failed: ${response.status}`);
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  normalizeSolscanLimit(limit) {
    const allowed = [10, 20, 30, 40];
    const value = Number(limit) || 10;
    return allowed.includes(value) ? value : allowed.find((item) => item >= value) || 40;
  }

  async getSolscanAccountDetail(address) {
    return this.solscanRequest("account/detail", { address });
  }

  async getSolscanAccountTransactions(address, { before = null, limit = 10 } = {}) {
    return this.solscanRequest("account/transactions", {
      address,
      before,
      limit: this.normalizeSolscanLimit(limit)
    });
  }

  async getSolscanTransactionDetail(signature) {
    return this.solscanRequest("transaction/detail", { tx: signature });
  }

  async getSolscanTransactionActions(signature) {
    return this.solscanRequest("transaction/actions", { tx: signature });
  }

  async getExplorerSnapshot(address, { limit = 10 } = {}) {
    const accountDetail = await this.getSolscanAccountDetail(address);
    const transactions = await this.getSolscanAccountTransactions(address, { limit });
    const portfolio = await this.solscanRequest("account/portfolio", { address }).catch(() => null);
    const tokenAccounts = await this.solscanRequest("account/token-accounts", {
      address,
      type: "token",
      page: 1,
      page_size: this.normalizeSolscanLimit(limit),
      hide_zero: true
    }).catch(() => null);

    return {
      provider: "solscan",
      address,
      accountDetail,
      transactions,
      portfolio,
      tokenAccounts
    };
  }

  async getTransactionSummary(signature) {
    const transaction = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });

    if (!transaction) {
      return null;
    }

    const feeLamports = transaction.meta?.fee || 0;
    const instructionCount = transaction.transaction.message.instructions.length;
    const accountKeys = transaction.transaction.message.accountKeys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      signer: key.signer,
      writable: key.writable
    }));

    return {
      signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime ? new Date(transaction.blockTime * 1000).toISOString() : null,
      status: transaction.meta?.err ? "failed" : "success",
      feeSol: feeLamports / 1_000_000_000,
      instructionCount,
      accounts: accountKeys
    };
  }

  async requestAirdrop(walletAddress, solAmount = 1) {
    const lamports = Math.round(Number(solAmount) * 1_000_000_000);
    const signature = await this.connection.requestAirdrop(new PublicKey(walletAddress), lamports);
    await this.connection.confirmTransaction(signature, "confirmed");

    return {
      signature,
      walletAddress,
      solAmount: Number(solAmount),
      network: this.network
    };
  }

  async watchAccount(address, onEvent) {
    const publicKey = new PublicKey(address);
    const subscriptionId = await this.connection.onAccountChange(
      publicKey,
      (accountInfo, context) => {
        onEvent({
          type: "account",
          address,
          slot: context.slot,
          account: normalizeAccountInfo(accountInfo)
        });
      },
      "confirmed"
    );

    return async () => {
      await this.connection.removeAccountChangeListener(subscriptionId);
    };
  }

  async watchSignature(signature, onEvent) {
    const subscriptionId = this.connection.onSignature(
      signature,
      (result, context) => {
        onEvent({
          type: "signature",
          signature,
          slot: context.slot,
          status: result.err ? "failed" : "confirmed",
          err: result.err || null
        });
      },
      "confirmed"
    );

    return async () => {
      await this.connection.removeSignatureListener(subscriptionId);
    };
  }

  async watchLogs(address, onEvent) {
    const filter = address ? { mentions: [address] } : "all";
    const subscriptionId = await this.connection.onLogs(
      filter,
      (logInfo, context) => {
        onEvent({
          type: "logs",
          address: address || "all",
          slot: context.slot,
          signature: logInfo.signature,
          err: logInfo.err || null,
          logs: logInfo.logs || []
        });
      },
      "confirmed"
    );

    return async () => {
      await this.connection.removeOnLogsListener(subscriptionId);
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
