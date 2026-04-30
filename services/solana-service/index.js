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

function toBase58(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return value.toBase58?.() || value.toString?.() || null;
}

function normalizeParsedInstruction(instruction, accountKeys) {
  const programId = toBase58(instruction.programId) || accountKeys?.[instruction.programIdIndex]?.pubkey || null;
  const accounts = Array.isArray(instruction.accounts)
    ? instruction.accounts.map((accountIndex) => accountKeys?.[accountIndex]?.pubkey || String(accountIndex))
    : [];
  const parsed = instruction.parsed
    ? {
        type: instruction.parsed.type || null,
        info: instruction.parsed.info || null
      }
    : null;

  return {
    programId,
    program: instruction.program || null,
    accounts,
    parsed
  };
}

function normalizeTokenBalance(balance) {
  return {
    accountIndex: balance.accountIndex,
    mint: balance.mint,
    owner: balance.owner || null,
    uiAmount: balance.uiTokenAmount?.uiAmount ?? null,
    uiAmountString: balance.uiTokenAmount?.uiAmountString ?? null,
    amount: balance.uiTokenAmount?.amount ?? null,
    decimals: balance.uiTokenAmount?.decimals ?? null
  };
}

function diffTokenBalances(preBalances = [], postBalances = []) {
  const preMap = new Map();
  for (const entry of preBalances) {
    const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
    preMap.set(key, entry);
  }

  const seen = new Set();
  const diffs = [];
  for (const post of postBalances) {
    const key = `${post.accountIndex}:${post.mint}:${post.owner || ""}`;
    const pre = preMap.get(key) || null;
    seen.add(key);
    const preAmount = Number(pre?.amount || 0);
    const postAmount = Number(post.amount || 0);
    const deltaAmount = postAmount - preAmount;
    if (pre || postAmount !== 0 || preAmount !== 0) {
      diffs.push({
        accountIndex: post.accountIndex,
        mint: post.mint,
        owner: post.owner || null,
        pre: pre ? normalizeTokenBalance(pre) : null,
        post: normalizeTokenBalance(post),
        deltaAmount: String(deltaAmount)
      });
    }
  }

  for (const pre of preBalances) {
    const key = `${pre.accountIndex}:${pre.mint}:${pre.owner || ""}`;
    if (seen.has(key)) continue;
    const preAmount = Number(pre?.amount || 0);
    diffs.push({
      accountIndex: pre.accountIndex,
      mint: pre.mint,
      owner: pre.owner || null,
      pre: normalizeTokenBalance(pre),
      post: null,
      deltaAmount: String(0 - preAmount)
    });
  }

  return diffs;
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

    const message = transaction.transaction.message;
    const feeLamports = transaction.meta?.fee || 0;
    const instructionCount = message.instructions.length;
    const accountKeys = message.accountKeys.map((key) => ({
      pubkey: toBase58(key.pubkey),
      signer: key.signer,
      writable: key.writable
    }));
    const instructions = message.instructions.map((instruction, index) => ({
      index,
      ...normalizeParsedInstruction(instruction, accountKeys)
    }));
    const programIds = [...new Set(instructions.map((instruction) => instruction.programId).filter(Boolean))];
    const preBalances = transaction.meta?.preBalances || [];
    const postBalances = transaction.meta?.postBalances || [];
    const balanceChanges = accountKeys
      .map((key, index) => {
        const pre = Number(preBalances[index] || 0);
        const post = Number(postBalances[index] || 0);
        const delta = post - pre;
        return {
          accountIndex: index,
          pubkey: key.pubkey,
          signer: key.signer,
          writable: key.writable,
          preLamports: String(pre),
          postLamports: String(post),
          deltaLamports: String(delta)
        };
      })
      .filter((entry) => entry.deltaLamports !== "0");
    const preTokenBalances = (transaction.meta?.preTokenBalances || []).map(normalizeTokenBalance);
    const postTokenBalances = (transaction.meta?.postTokenBalances || []).map(normalizeTokenBalance);

    return {
      signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime ? new Date(transaction.blockTime * 1000).toISOString() : null,
      status: transaction.meta?.err ? "failed" : "success",
      err: transaction.meta?.err || null,
      feeSol: feeLamports / 1_000_000_000,
      feeLamports,
      computeUnitsConsumed: transaction.meta?.computeUnitsConsumed || null,
      instructionCount,
      innerInstructionCount: transaction.meta?.innerInstructions?.length || 0,
      programIds,
      instructions,
      accounts: accountKeys,
      balanceChanges,
      tokenBalanceChanges: diffTokenBalances(preTokenBalances, postTokenBalances),
      logs: transaction.meta?.logMessages || []
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
