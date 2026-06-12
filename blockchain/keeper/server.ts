// T6 — the price keeper: an off-chain HTTP service that serves committee-signed price reports the
// on-chain UniversalSignedSource adapters verify at read time. The keeper is TRANSPORT, not a price
// origin: it signs synthetic/real-ticker prices with the demo committee keys and relays them. It never
// custodies funds and never moves value.
//
// Run (from blockchain/):
//   KEEPER_KEYS=0x..,0x.. node --import tsx/esm keeper/server.ts        # or ts-node
//   curl 'http://localhost:8787/reports?assets=NVDA,AAPL'
//   curl 'http://localhost:8787/reports'                                # all demo stocks
//
// Response shape: { "<stockAddress>": { ticker, priceUsd, weekday: "0x..", weekend: "0x.." } }
// `weekday`/`weekend` are the ABI-encoded payloads to pass to the aggregator/settler IN THE SAME ORDER
// the sources were registered (weekday source first, weekend second).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import { buildUniversalPayload } from "./sign";

const CONFIG = process.env.DEPLOY_CONFIG ?? join(__dirname, "..", "config", "testnet.json");
const KEYS = (process.env.KEEPER_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
const DEPTH = 5_000_000n * 10n ** 18n; // matches config.params.depthTier; > dMin => full confidence
const PORT = Number(process.env.KEEPER_PORT ?? 8787);

if (KEYS.length === 0) throw new Error("set KEEPER_KEYS (comma-separated committee privkeys) in env");

type DemoStock = { address: string; priceUsd: number };
function stocks(): Record<string, DemoStock> {
  return JSON.parse(readFileSync(CONFIG, "utf8")).params?.demo?.stocks ?? {};
}

async function reportFor(ticker: string, priceUsd: number, nowSec: bigint) {
  const rep = {
    feedId: ethers.id(ticker),
    price: ethers.parseUnits(priceUsd.toFixed(8), 18), // USD * 1e18
    depth: DEPTH,
    lastUpdate: nowSec,
  };
  const payload = await buildUniversalPayload(rep, KEYS);
  // weekday + weekend sources share the encoder/report -> same payload for both (registration order).
  return { weekday: payload, weekend: payload };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/reports") {
      const want = (url.searchParams.get("assets") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const all = stocks();
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const out: Record<string, unknown> = {};
      for (const [ticker, v] of Object.entries(all)) {
        if (want.length && !want.includes(ticker) && !want.includes(v.address)) continue;
        const { weekday, weekend } = await reportFor(ticker, v.priceUsd, nowSec);
        out[v.address] = { ticker, priceUsd: v.priceUsd, weekday, weekend };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    if (url.pathname === "/health") { res.writeHead(200).end("ok"); return; }
    res.writeHead(404).end("not found");
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`keeper on :${PORT} (committee-signed, sandbox/synthetic prices)`));
