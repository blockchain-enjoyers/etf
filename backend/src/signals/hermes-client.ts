import type { PythHermes, PythPrice } from "./pyth.adapter.js";

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface HermesParsed {
  parsed?: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[];
}

export function createHermesClient(baseUrl: string, fetchImpl: FetchLike = fetch): PythHermes {
  const base = baseUrl.replace(/\/$/, "");
  return {
    async getLatestPrice(priceId: string): Promise<PythPrice | undefined> {
      const res = await fetchImpl(`${base}/v2/updates/price/latest?ids[]=${priceId}`);
      if (!res.ok) return undefined;
      const body = (await res.json()) as HermesParsed;
      const p = body.parsed?.[0]?.price;
      if (!p) return undefined;
      return { price: BigInt(p.price), conf: BigInt(p.conf), expo: p.expo, publishTime: p.publish_time };
    },
  };
}
