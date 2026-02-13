import { NextResponse } from "next/server";

type BtcPayload = {
  price: number | null;
  change24h: number | null;
  source: string;
  ts: number;
};

type ProviderResult = {
  ok: boolean;
  name: string;
  data?: BtcPayload;
  error?: string;
};

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

async function fromCoinbase(): Promise<ProviderResult> {
  try {
    const data = await fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const amount = data?.data?.amount;
    const price = amount == null ? null : Number(amount);

    if (price == null || Number.isNaN(price)) {
      return { ok: false, name: "coinbase", error: "missing/invalid price" };
    }

    return {
      ok: true,
      name: "coinbase",
      data: { price, change24h: null, source: "coinbase", ts: Date.now() },
    };
  } catch (error) {
    return {
      ok: false,
      name: "coinbase",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

async function fromKraken(): Promise<ProviderResult> {
  try {
    const data = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
    const ticker = data?.result?.XXBTZUSD;
    const last = ticker?.c?.[0];
    const open = ticker?.o;
    const price = last == null ? null : Number(last);
    const openPrice = open == null ? null : Number(open);

    if (price == null || Number.isNaN(price)) {
      return { ok: false, name: "kraken", error: "missing/invalid price" };
    }

    const change24h =
      openPrice == null || Number.isNaN(openPrice) || openPrice === 0
        ? null
        : ((price - openPrice) / openPrice) * 100;

    return {
      ok: true,
      name: "kraken",
      data: { price, change24h, source: "kraken", ts: Date.now() },
    };
  } catch (error) {
    return {
      ok: false,
      name: "kraken",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

async function fromCoinCap(): Promise<ProviderResult> {
  try {
    const data = await fetchJson("https://api.coincap.io/v2/assets/bitcoin");
    const asset = data?.data;
    const price = asset?.priceUsd ? Number(asset.priceUsd) : null;
    const change24h = asset?.changePercent24Hr ? Number(asset.changePercent24Hr) : null;

    if (price == null || Number.isNaN(price)) {
      return { ok: false, name: "coincap", error: "missing/invalid price" };
    }

    return {
      ok: true,
      name: "coincap",
      data: { price, change24h, source: "coincap", ts: Date.now() },
    };
  } catch (error) {
    return {
      ok: false,
      name: "coincap",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

async function fromCoinGecko(): Promise<ProviderResult> {
  try {
    const data = await fetchJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"
    );
    const price = data?.bitcoin?.usd ?? null;
    const change24h = data?.bitcoin?.usd_24h_change ?? null;

    if (price == null || Number.isNaN(Number(price))) {
      return { ok: false, name: "coingecko", error: "missing/invalid price" };
    }

    return {
      ok: true,
      name: "coingecko",
      data: {
        price: Number(price),
        change24h: change24h == null ? null : Number(change24h),
        source: "coingecko",
        ts: Date.now(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      name: "coingecko",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}


export async function GET() {
  const providers = [fromCoinbase, fromKraken, fromCoinCap, fromCoinGecko];
  const failures: Array<{ provider: string; error: string }> = [];

  for (const provider of providers) {
    const result = await provider();
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
      error: "Failed to fetch BTC price from all providers",
      providers: failures,
    },
    {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
