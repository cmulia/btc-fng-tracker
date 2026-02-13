import { NextResponse } from "next/server";

type DominanceResult = {
  value: number | null;
  source: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HALVINGS_UTC = [
  Date.UTC(2012, 10, 28),
  Date.UTC(2016, 6, 9),
  Date.UTC(2020, 4, 11),
  Date.UTC(2024, 3, 20),
];
const NEXT_HALVING_ESTIMATE_UTC = Date.UTC(2028, 3, 20);

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "btc-fng-tracker/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchDominanceFromCoinGecko(): Promise<DominanceResult | null> {
  try {
    const data = await fetchJson("https://api.coingecko.com/api/v3/global");
    const value = Number(data?.data?.market_cap_percentage?.btc);
    if (!Number.isFinite(value)) return null;
    return { value, source: "coingecko" };
  } catch {
    return null;
  }
}

async function fetchDominanceFromCoinPaprika(): Promise<DominanceResult | null> {
  try {
    const data = await fetchJson("https://api.coinpaprika.com/v1/global");
    const candidates = [
      data?.bitcoin_dominance_percentage,
      data?.btc_dominance,
      data?.market_cap_change_24h,
    ];
    const found = candidates
      .map((value: unknown) => Number(value))
      .find((value) => Number.isFinite(value) && value >= 0 && value <= 100);
    if (found == null) return null;
    return { value: found, source: "coinpaprika" };
  } catch {
    return null;
  }
}

function computeCycleStats(now: number) {
  const lastHalving = [...HALVINGS_UTC]
    .reverse()
    .find((halvingTs) => halvingTs <= now) ?? HALVINGS_UTC[HALVINGS_UTC.length - 1];
  const nextHalving = NEXT_HALVING_ESTIMATE_UTC > now ? NEXT_HALVING_ESTIMATE_UTC : now;

  const daysSinceLastHalving = Math.max(0, Math.floor((now - lastHalving) / DAY_MS));
  const daysToNextHalving = Math.max(0, Math.ceil((nextHalving - now) / DAY_MS));
  const cycleProgressPct =
    nextHalving === lastHalving
      ? 100
      : Math.max(0, Math.min(100, ((now - lastHalving) / (nextHalving - lastHalving)) * 100));

  return {
    daysSinceLastHalving,
    daysToNextHalving,
    cycleProgressPct,
    lastHalving,
    nextHalving,
  };
}

export async function GET() {
  const now = Date.now();
  const cycle = computeCycleStats(now);

  const dominance =
    (await fetchDominanceFromCoinGecko()) ??
    (await fetchDominanceFromCoinPaprika()) ??
    { value: null, source: "unavailable" };

  return NextResponse.json(
    {
      ...cycle,
      btcDominance: dominance.value,
      dominanceSource: dominance.source,
      ts: now,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
