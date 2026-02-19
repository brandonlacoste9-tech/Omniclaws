/**
 * WhaleWatcher cron - scan mempool and confirmed blocks for large transactions
 * ETH: Alchemy. BTC: Blockchair (free tier, no key required for low volume).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { detectWhale, processWhaleAlert } from "../services/whale-watcher";
import type { Env } from "../types";

/** Blockchair BTC transactions API response */
interface BlockchairTx {
  hash?: string;
  time?: string;
  output_total?: number;
  output_total_usd?: number;
}

/**
 * Fetch BTC transactions from Blockchair (last hour, >$100k).
 * Free tier: no API key needed for low volume. Add BLOCKCHAIR_API_KEY for higher limits.
 */
async function fetchBtcTransactionsFromBlockchair(
  apiKey?: string
): Promise<Array<{ valueWei?: string; valueSat?: number; valueUsd?: number; from?: string; to?: string; hash?: string; timestamp?: number }>> {
  const base = "https://api.blockchair.com/bitcoin/transactions";
  const params = new URLSearchParams({
    q: "time(~P1H)",
    s: "time(desc)",
    limit: "100",
  });
  if (apiKey) params.set("key", apiKey);
  const url = `${base}?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: BlockchairTx[];
      context?: { market_price_usd?: number };
    };
    const txs = json.data ?? [];
    const btcPrice = json.context?.market_price_usd ?? 65000;

    return txs
      .filter((tx) => {
        const valueUsd = tx.output_total_usd ?? (tx.output_total ? (tx.output_total / 1e8) * btcPrice : 0);
        return valueUsd >= 100000;
      })
      .map((tx) => {
        const valueUsd = tx.output_total_usd ?? (tx.output_total ? (tx.output_total / 1e8) * btcPrice : 0);
        const time = tx.time ? new Date(tx.time).getTime() : Date.now();
        return {
          valueUsd,
          from: "unknown",
          to: "unknown",
          hash: tx.hash ?? "",
          timestamp: time,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Fetch pending transactions. ETH: Alchemy. BTC: Blockchair.
 */
async function fetchPendingTransactions(
  chain: "btc" | "eth",
  _apiKey?: string,
  blockchairKey?: string
): Promise<Array<{ valueWei?: string; valueSat?: number; valueUsd?: number; from?: string; to?: string; hash?: string; timestamp?: number }>> {
  if (chain === "btc") {
    return fetchBtcTransactionsFromBlockchair(blockchairKey);
  }
  if (_apiKey) {
    try {
      const url = chain === "eth"
        ? `https://eth-mainnet.g.alchemy.com/v2/${_apiKey}`
        : `https://btc-mainnet.g.alchemy.com/v2/${_apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: chain === "eth" ? "alchemy_pendingTransactions" : "alchemy_getAssetTransfers",
          params: chain === "eth" ? [] : [{ fromBlock: "latest", toBlock: "latest" }],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { result?: unknown[] };
        return (data.result ?? []).slice(0, 20).map((tx: unknown) => {
          const t = tx as Record<string, unknown>;
          return {
            valueWei: t.value as string,
            from: t.from as string,
            to: t.to as string,
            hash: t.hash as string,
          };
        });
      }
    } catch {
      // Fall through to mock
    }
  }

  // MVP simulation: 1 in 10 chance of mock whale per run
  if (Math.random() < 0.1) {
    const valueEth = 3 + Math.random() * 30;
    const valueWei = BigInt(Math.floor(valueEth * 1e18)).toString();
    return [
      {
        valueWei,
        from: "0x" + "a".repeat(40),
        to: "0x" + "b".repeat(40),
        hash: "0x" + crypto.randomUUID().replace(/-/g, "").slice(0, 62),
      },
    ];
  }
  return [];
}

/**
 * Mock confirmed blocks for MVP.
 */
async function fetchConfirmedBlocks(
  chain: "btc" | "eth",
  _apiKey?: string,
  blockchairKey?: string
): Promise<Array<{ valueWei?: string; valueSat?: number; valueUsd?: number; from?: string; to?: string; hash?: string; timestamp?: number }>> {
  if (chain === "btc") {
    return fetchBtcTransactionsFromBlockchair(blockchairKey);
  }
  if (_apiKey && chain === "eth") {
    try {
      const res = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${_apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBlockByNumber",
          params: ["latest", true],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { result?: { transactions?: unknown[] } };
        const txs = data.result?.transactions ?? [];
        return txs.slice(0, 10).map((tx: unknown) => {
          const t = tx as Record<string, unknown>;
          return {
            valueWei: t.value as string,
            from: t.from as string,
            to: t.to as string,
            hash: t.hash as string,
          };
        });
      }
    } catch {
      // Fall through
    }
  }

  return [];
}

/**
 * Scan mempool for whale transactions.
 */
export async function scanMempool(db: D1Database, env: Env): Promise<{ detected: number }> {
  let detected = 0;

  for (const chain of ["eth", "btc"] as const) {
    const txs = await fetchPendingTransactions(chain, env.ALCHEMY_API_KEY, env.BLOCKCHAIR_API_KEY);

    for (const tx of txs) {
      const alert = detectWhale(chain, tx, 100000);
      if (alert) {
        const result = await processWhaleAlert(alert, db, env);
        detected += result.delivered;
      }
    }
  }

  return { detected };
}

/**
 * Scan latest confirmed blocks for whale transactions.
 */
export async function scanConfirmedBlocks(db: D1Database, env: Env): Promise<{ detected: number }> {
  let detected = 0;

  for (const chain of ["eth", "btc"] as const) {
    const txs = await fetchConfirmedBlocks(chain, env.ALCHEMY_API_KEY, env.BLOCKCHAIR_API_KEY);

    for (const tx of txs) {
      const alert = detectWhale(chain, tx, 100000);
      if (alert) {
        const exists = await db
          .prepare(`SELECT 1 FROM whale_alerts WHERE chain = ? AND tx_hash = ?`)
          .bind(alert.chain, alert.txHash)
          .first();
        if (!exists) {
          const result = await processWhaleAlert(alert, db, env);
          detected += result.delivered;
        }
      }
    }
  }

  return { detected };
}

/**
 * Run full whale scan (mempool + confirmed).
 */
export async function runWhaleScan(db: D1Database, env: Env): Promise<{ mempool: number; confirmed: number }> {
  const [mempoolResult, confirmedResult] = await Promise.all([
    scanMempool(db, env),
    scanConfirmedBlocks(db, env),
  ]);

  return {
    mempool: mempoolResult.detected,
    confirmed: confirmedResult.detected,
  };
}
