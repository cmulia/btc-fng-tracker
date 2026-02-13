import { NextRequest, NextResponse } from "next/server";

type RangeKey = "24h" | "7d" | "1m" | "1y" | "5y" | "10y";

type Point = {
  t: number;
  p: number;
};

type SeriesPayload = {
  range: RangeKey;
  source: string;
  points: Point[];
  ts: number;
};

type ProviderResult = {
  ok: boolean;
  name: string;
  data?: SeriesPayload;
  error?: string;
};

const RANGE_CONFIG: Record<
  RangeKey,
  { days: number; coincapInterval: "h1" | "h6" | "d1"; fallbackPoints: number }
> = {
  "24h": { days: 1, coincapInterval: "h1", fallbackPoints: 48 },
  "7d": { days: 7, coincapInterval: "h1", fallbackPoints: 84 },
  "1m": { days: 30, coincapInterval: "h6", fallbackPoints: 90 },
  "1y": { days: 365, coincapInterval: "d1", fallbackPoints: 120 },
  "5y": { days: 1825, coincapInterval: "d1", fallbackPoints: 160 },
  "10y": { days: 3650, coincapInterval: "d1", fallbackPoints: 180 },
};

const BINANCE_CONFIG: Record<
  RangeKey,
  { interval: "15m" | "1h" | "4h" | "1d" | "1w"; limit: number }
> = {
  "24h": { interval: "15m", limit: 96 },
  "7d": { interval: "1h", limit: 168 },
  "1m": { interval: "4h", limit: 180 },
  "1y": { interval: "1d", limit: 365 },
  "5y": { interval: "1w", limit: 260 },
  "10y": { interval: "1w", limit: 520 },
};

function toRangeKey(value: string | null): RangeKey {
  if (!value) return "24h";
  if (value in RANGE_CONFIG) {
    return value as RangeKey;
  }
  return "24h";
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "btc-fng-tracker/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

function cleanPoints(points: Point[]): Point[] {
  return points
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p))
    .sort((a, b) => a.t - b.t);
}

async function fromCoinGecko(range: RangeKey): Promise<ProviderResult> {
  try {
    const days = RANGE_CONFIG[range].days;
    const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`;
    const data = await fetchJson(url);
    const points = cleanPoints(
      (data?.prices ?? []).map((entry: [number, number]) => ({
        t: Number(entry?.[0]),
        p: Number(entry?.[1]),
      }))
    );

    if (points.length < 2) {
      return { ok: false, name: "coingecko", error: "insufficient points" };
    }

    return {
      ok: true,
      name: "coingecko",
      data: { range, source: "coingecko", points, ts: Date.now() },
    };
  } catch (error) {
    return {
      ok: false,
      name: "coingecko",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

async function fromCoinCap(range: RangeKey): Promise<ProviderResult> {
  try {
    const now = Date.now();
    const { days, coincapInterval } = RANGE_CONFIG[range];
    const start = now - days * 24 * 60 * 60 * 1000;
    const params = new URLSearchParams({
      interval: coincapInterval,
      start: String(start),
      end: String(now),
    });
    const data = await fetchJson(
      `https://api.coincap.io/v2/assets/bitcoin/history?${params.toString()}`
    );
    const points = cleanPoints(
      (data?.data ?? []).map((entry: { time: number; priceUsd: string }) => ({
        t: Number(entry?.time),
        p: Number(entry?.priceUsd),
      }))
    );

    if (points.length < 2) {
      return { ok: false, name: "coincap", error: "insufficient points" };
    }

    return {
      ok: true,
      name: "coincap",
      data: { range, source: "coincap", points, ts: Date.now() },
    };
  } catch (error) {
    return {
      ok: false,
      name: "coincap",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

async function fromBinance(range: RangeKey): Promise<ProviderResult> {
  try {
    const now = Date.now();
    const days = RANGE_CONFIG[range].days;
    const start = now - days * 24 * 60 * 60 * 1000;
    const { interval, limit } = BINANCE_CONFIG[range];
    const params = new URLSearchParams({
      symbol: "BTCUSDT",
      interval,
      limit: String(limit),
    });

    const data = (await fetchJson(
      `https://api.binance.com/api/v3/klines?${params.toString()}`
    )) as Array<[number, string, string, string, string]>;

    const points = cleanPoints(
      (data ?? [])
        .map((entry) => ({
          t: Number(entry?.[0]),
          p: Number(entry?.[4]), // close
        }))
        .filter((point) => point.t >= start && point.t <= now)
    );

    if (points.length < 2) {
      return { ok: false, name: "binance", error: "insufficient points" };
    }

    return {
      ok: true,
      name: "binance",
      data: { range, source: "binance", points, ts: Date.now() },
    };
  } catch (error) {
    return {
      ok: false,
      name: "binance",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

async function fromSpotFallback(
  range: RangeKey,
  req: NextRequest
): Promise<ProviderResult> {
  try {
    const now = Date.now();
    const { days, fallbackPoints } = RANGE_CONFIG[range];
    const start = now - days * 24 * 60 * 60 * 1000;
    const step = Math.max(1, Math.floor((now - start) / (fallbackPoints - 1)));

    const btcRes = await fetch(
      `${req.nextUrl.origin}/api/btc`,
      {
        headers: {
          accept: "application/json",
          "user-agent": "btc-fng-tracker/1.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!btcRes.ok) {
      return { ok: false, name: "spot-fallback", error: `HTTP ${btcRes.status}` };
    }

    const btcData = await btcRes.json();
    const price = btcData?.price == null ? null : Number(btcData.price);
    if (price == null || Number.isNaN(price)) {
      return { ok: false, name: "spot-fallback", error: "missing/invalid spot price" };
    }

    const points: Point[] = [];
    for (let idx = 0; idx < fallbackPoints; idx += 1) {
      points.push({ t: start + idx * step, p: price });
    }

    return {
      ok: true,
      name: "spot-fallback",
      data: {
        range,
        source: "spot-fallback",
        points,
        ts: Date.now(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      name: "spot-fallback",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export async function GET(req: NextRequest) {
  const range = toRangeKey(req.nextUrl.searchParams.get("range"));
  const providers = [
    fromCoinGecko,
    fromCoinCap,
    fromBinance,
    (selectedRange: RangeKey) => fromSpotFallback(selectedRange, req),
  ];
  const failures: Array<{ provider: string; error: string }> = [];

  for (const provider of providers) {
    const result = await provider(range);
    if (result.ok && result.data) {
      return NextResponse.json(result.data, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    failures.push({
      provider: result.name,
      error: result.error ?? "unknown error",
    });
  }

  return NextResponse.json(
    {
      error: "Failed to fetch BTC chart data from all providers",
      range,
      providers: failures,
    },
    {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
