import { NextRequest, NextResponse } from "next/server";

type RangeKey = "24h" | "7d" | "1m" | "1y" | "5y" | "10y";

type Point = {
  t: number;
  v: number;
};

const RANGE_TO_DAYS: Record<RangeKey, number> = {
  "24h": 1,
  "7d": 7,
  "1m": 30,
  "1y": 365,
  "5y": 365 * 5,
  "10y": 365 * 10,
};

function toRangeKey(value: string | null): RangeKey {
  if (!value) return "24h";
  if (value in RANGE_TO_DAYS) return value as RangeKey;
  return "24h";
}

export async function GET(req: NextRequest) {
  const range = toRangeKey(req.nextUrl.searchParams.get("range"));
  const days = RANGE_TO_DAYS[range];
  const now = Date.now();
  const start = now - days * 24 * 60 * 60 * 1000;

  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=0&format=json", {
      headers: {
        accept: "application/json",
        "user-agent": "btc-fng-tracker/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch F&G history: HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const points: Point[] = (data?.data ?? [])
      .map((item: { timestamp?: string; value?: string }) => ({
        t: Number(item?.timestamp) * 1000,
        v: Number(item?.value),
      }))
      .filter((point: Point) => Number.isFinite(point.t) && Number.isFinite(point.v))
      .filter((point: Point) => point.t >= start && point.t <= now)
      .sort((a: Point, b: Point) => a.t - b.t);

    return NextResponse.json(
      {
        range,
        source: "alternative.me",
        points,
        ts: now,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Failed to fetch F&G history: ${error.message}`
            : "Failed to fetch F&G history",
      },
      { status: 502 }
    );
  }
}

