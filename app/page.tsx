"use client";

import { type CSSProperties, type FormEvent, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

type RangeKey = "24h" | "7d" | "1m" | "1y" | "5y" | "10y";

type ChartPoint = {
  t: number;
  p: number;
};

type ChartPayload = {
  range: RangeKey;
  source: string;
  points: ChartPoint[];
  ts: number;
};

type CyclePayload = {
  daysToNextHalving: number;
  daysSinceLastHalving: number;
  cycleProgressPct: number;
  lastHalving: number;
  nextHalving: number;
  btcDominance: number | null;
  dominanceSource: string;
  ts: number;
};

type FngHistoryPayload = {
  range: RangeKey;
  source: string;
  points: Array<{ t: number; v: number }>;
  ts: number;
};

type SessionPayload = {
  authenticated: boolean;
  username?: string;
};

type SectionKey =
  | "overview"
  | "btc-metrics"
  | "sentiment"
  | "cycle"
  | "chart"
  | "controls";

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "24h", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
  { key: "10y", label: "10Y" },
];
const FNG_RANGE_OPTIONS: Array<{ key: "1m" | "1y" | "5y"; label: string }> = [
  { key: "1m", label: "30D" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
];
const AI_DEFAULT_HEADLINE = "Click Analyse to see what I think.";
const MY_COIN_STORAGE_KEY = "btc_dashboard_my_coin_v1";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
};

function normalizeChartPayload(input: ChartPayload): ChartPayload {
  const deduped = new Map<number, number>();
  for (const rawPoint of input?.points ?? []) {
    const t = Number(rawPoint?.t);
    const p = Number(rawPoint?.p);
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    deduped.set(t, p);
  }

  let cleanedPoints = [...deduped.entries()]
    .map((point) => ({
      t: Number(point[0]),
      p: Number(point[1]),
    }))
    .filter((point) => point.p > 1000 && point.p < 5_000_000)
    .sort((a, b) => a.t - b.t);

  if (cleanedPoints.length >= 5) {
    const sortedPrices = [...cleanedPoints].map((point) => point.p).sort((a, b) => a - b);
    const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
    const low = median * 0.2;
    const high = median * 5;
    cleanedPoints = cleanedPoints.filter((point) => point.p >= low && point.p <= high);
  }

  if (cleanedPoints.length < 2) {
    throw new Error("Insufficient chart points");
  }

  return {
    ...input,
    points: cleanedPoints,
  };
}

function parseRangeFromUrl(url: string): RangeKey {
  try {
    const parsed = new URL(url, "http://localhost");
    const rangeParam = parsed.searchParams.get("range");
    if (rangeParam === "24h" || rangeParam === "7d" || rangeParam === "1m" || rangeParam === "1y" || rangeParam === "5y" || rangeParam === "10y") {
      return rangeParam;
    }
  } catch {
    // ignore and fall back
  }
  return "24h";
}

const chartFetcher = async (url: string): Promise<ChartPayload> => {
  const range = parseRangeFromUrl(url);
  try {
    const data = (await fetcher(url)) as ChartPayload;
    return normalizeChartPayload(data);
  } catch {
    try {
      const btc = (await fetcher("/api/btc")) as { price?: number };
      const price = Number(btc?.price);
      return buildSyntheticChart(range, Number.isFinite(price) ? price : null);
    } catch {
      return buildSyntheticChart(range, null);
    }
  }
};

function formatUsd(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatSignedPercent(n: number | null) {
  if (n == null) return "N/A";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatChartDate(ts: number, range: RangeKey) {
  if (range === "24h") {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (range === "7d" || range === "1m") {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    });
  }

  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAxisTick(ts: number, range: RangeKey) {
  if (range === "24h") {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (range === "7d" || range === "1m") {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  if (range === "1y") {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    });
  }

  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
  });
}

function formatRelativeAiTime(ts: number | null) {
  if (ts == null) return "AI idle";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins <= 0) return "AI now";
  if (mins === 1) return "AI 1m";
  return `AI ${mins}m`;
}

function buildDemoHeadline(input: {
  price: number | null;
  dailyChange: number | null;
  sentimentLabel: string | null;
}) {
  const { price, dailyChange, sentimentLabel } = input;
  if (price == null) {
    return "Demo insight: waiting for live data; use this view to understand structure and timing, then compare momentum and sentiment before acting.";
  }
  const momentum =
    dailyChange == null
      ? "mixed momentum"
      : dailyChange >= 1
        ? "positive momentum"
        : dailyChange <= -1
          ? "defensive momentum"
          : "sideways momentum";
  const sentiment = sentimentLabel?.toLowerCase() ?? "neutral sentiment";
  return `Demo insight: price action suggests ${momentum} while ${sentiment} keeps conviction moderate, so monitor confirmation across sessions before committing to any directional exposure.`;
}

function loadMyCoinField(field: "amount" | "entry"): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(MY_COIN_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { amount?: unknown; entry?: unknown };
    const value = parsed[field];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function findNearestPointIndex(points: ChartPoint[], targetTs: number) {
  if (points.length === 0) return -1;
  let left = 0;
  let right = points.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const value = points[mid].t;

    if (value < targetTs) {
      left = mid + 1;
    } else if (value > targetTs) {
      right = mid - 1;
    } else {
      return mid;
    }
  }

  if (left >= points.length) return points.length - 1;
  if (left <= 0) return 0;

  const prev = points[left - 1];
  const next = points[left];
  return Math.abs(prev.t - targetTs) <= Math.abs(next.t - targetTs)
    ? left - 1
    : left;
}

function buildChart(points: ChartPoint[]) {
  if (points.length < 2) {
    return null;
  }

  const width = 1000;
  const height = 620;
  const padX = 4;
  const padY = 4;
  const minY = Math.min(...points.map((point) => point.p));
  const maxY = Math.max(...points.map((point) => point.p));
  const minX = points[0].t;
  const maxX = points[points.length - 1].t;

  const xRange = Math.max(1, maxX - minX);
  const yRange = Math.max(1, maxY - minY);

  const toX = (value: number) =>
    padX + ((value - minX) / xRange) * (width - padX * 2);
  const toY = (value: number) =>
    height - padY - ((value - minY) / yRange) * (height - padY * 2);

  const coords = points.map((point) => ({ x: toX(point.t), y: toY(point.p) }));
  const path = coords
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const area = `${path} L${coords[coords.length - 1].x.toFixed(2)} ${(height - padY).toFixed(2)} L${coords[0].x.toFixed(2)} ${(height - padY).toFixed(2)} Z`;

  return {
    width,
    height,
    padX,
    padY,
    minX,
    maxX,
    path,
    area,
    coords,
    minY,
    maxY,
  };
}

function movingAverage(points: ChartPoint[], period: number) {
  const result: Array<number | null> = new Array(points.length).fill(null);
  if (points.length === 0 || period <= 0) return result;

  let rollingSum = 0;
  for (let idx = 0; idx < points.length; idx += 1) {
    rollingSum += points[idx].p;
    if (idx >= period) rollingSum -= points[idx - period].p;
    if (idx >= period - 1) {
      result[idx] = rollingSum / period;
    }
  }
  return result;
}

function buildPathFromSeries(
  values: Array<number | null>,
  shape: ReturnType<typeof buildChart>
) {
  if (!shape) return null;
  const minY = shape.minY;
  const maxY = shape.maxY;
  const yRange = Math.max(1, maxY - minY);
  const toY = (value: number) =>
    shape.height - shape.padY - ((value - minY) / yRange) * (shape.height - shape.padY * 2);

  let path = "";
  for (let idx = 0; idx < values.length; idx += 1) {
    const value = values[idx];
    if (value == null || !shape.coords[idx]) continue;
    const cmd = path.length === 0 ? "M" : " L";
    path += `${cmd}${shape.coords[idx].x.toFixed(2)} ${toY(value).toFixed(2)}`;
  }
  return path || null;
}

function getRangeDays(range: RangeKey) {
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  if (range === "1m") return 30;
  if (range === "1y") return 365;
  if (range === "5y") return 365 * 5;
  return 365 * 10;
}

function buildSyntheticChart(range: RangeKey, price: number | null): ChartPayload {
  const now = Date.now();
  const days = getRangeDays(range);
  const pointsCount = range === "24h" ? 48 : range === "7d" ? 84 : 120;
  const start = now - days * 24 * 60 * 60 * 1000;
  const step = Math.max(1, Math.floor((now - start) / (pointsCount - 1)));
  const base = price ?? 60000;
  const points: ChartPoint[] = Array.from({ length: pointsCount }, (_, i) => {
    const wobble = Math.sin(i / 5) * base * 0.0025;
    return {
      t: start + i * step,
      p: base + wobble,
    };
  });

  return {
    range,
    source: "synthetic",
    points,
    ts: now,
  };
}

function buildSyntheticFng(range: RangeKey): FngHistoryPayload {
  const now = Date.now();
  const days = getRangeDays(range);
  const pointsCount = range === "24h" ? 48 : range === "7d" ? 84 : 120;
  const start = now - days * 24 * 60 * 60 * 1000;
  const step = Math.max(1, Math.floor((now - start) / (pointsCount - 1)));
  return {
    range,
    source: "synthetic",
    ts: now,
    points: Array.from({ length: pointsCount }, (_, i) => ({
      t: start + i * step,
      v: 50,
    })),
  };
}

export default function Home() {
  const [showSplash, setShowSplash] = useState(true);
  const [isSplashFading, setIsSplashFading] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [sessionUsername, setSessionUsername] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("chris");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginIsSubmitting, setLoginIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("24h");
  const [fngRange, setFngRange] = useState<"1m" | "1y" | "5y">("1m");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiIsAnalyzing, setAiIsAnalyzing] = useState(false);
  const [aiUpdatedAt, setAiUpdatedAt] = useState<number | null>(null);
  const [displayedAiHeadline, setDisplayedAiHeadline] = useState<string>("");
  const [isTypingAiHeadline, setIsTypingAiHeadline] = useState(false);
  const [myCoinAmount, setMyCoinAmount] = useState<string>(() => loadMyCoinField("amount"));
  const [myCoinEntry, setMyCoinEntry] = useState<string>(() => loadMyCoinField("entry"));
  const isDarkMode = true;
  const [pricePulse, setPricePulse] = useState<"up" | "down" | null>(null);
  const [rangeChartCache, setRangeChartCache] = useState<Partial<Record<RangeKey, ChartPayload>>>({});
  const canAccessDashboard = isAuthenticated || isDemoMode;
  const previousPriceRef = useRef<number | null>(null);

  const btc = useSWR(canAccessDashboard ? "/api/btc" : null, fetcher, { refreshInterval: 10_000 });
  const fng = useSWR(canAccessDashboard ? "/api/fng" : null, fetcher, { refreshInterval: 1_800_000 });
  const btc24h = useSWR<ChartPayload>(canAccessDashboard ? "/api/btc/history?range=24h" : null, fetcher, {
    refreshInterval: 60_000,
  });
  const cycle = useSWR<CyclePayload>(canAccessDashboard ? "/api/btc/cycle" : null, fetcher, {
    refreshInterval: 900_000,
  });
  const chart = useSWR<ChartPayload>(
    canAccessDashboard ? `/api/btc/history?range=${range}` : null,
    chartFetcher,
    {
      refreshInterval: range === "24h" || range === "7d" ? 60_000 : 600_000,
      keepPreviousData: true,
      revalidateOnFocus: false,
    }
  );
  const fngHistory = useSWR<FngHistoryPayload>(
    canAccessDashboard ? `/api/fng/history?range=${fngRange}` : null,
    fetcher,
    { refreshInterval: 1_800_000 }
  );
  const isRefreshing = btc.isValidating || fng.isValidating || chart.isValidating || cycle.isValidating;

  const price = btc.data?.price as number | null;
  const change24h = btc.data?.change24h as number | null;
  const fallback24hChange = useMemo(() => {
    const points = btc24h.data?.points;
    if (!points || points.length < 2) return null;
    const first = points[0]?.p;
    const last = points[points.length - 1]?.p;
    if (first == null || last == null || first === 0) return null;
    return ((last - first) / first) * 100;
  }, [btc24h.data?.points]);
  const effective24hChange = change24h ?? fallback24hChange;

  const fngValue = fng.data?.value as number | null;
  const fngLabel = fng.data?.label as string | null;
  const fngTimestamp = fng.data?.timestamp as number | null;

  const lastUpdated =
    btc.data?.ts ? new Date(btc.data.ts).toLocaleTimeString() : "—";

  const moodTone =
    fngValue == null
      ? "from-zinc-800 to-zinc-700 text-zinc-100"
      : fngValue >= 60
        ? "from-emerald-500/35 to-lime-400/25 text-emerald-100"
        : fngValue >= 45
          ? "from-amber-500/35 to-yellow-400/25 text-amber-100"
          : "from-rose-600/40 to-red-500/30 text-rose-100";
  const sentimentLabelTone =
    fngValue == null
      ? "text-zinc-400"
      : fngValue < 45
        ? "text-rose-400"
        : fngValue >= 60
          ? "text-emerald-400"
          : "text-amber-300";

  const changeTone =
    effective24hChange == null
      ? "text-zinc-600"
      : effective24hChange >= 0
        ? "text-emerald-600"
        : "text-rose-600";

  const btcSource = btc.data?.source ?? "—";
  const fngSource = fng.data?.source ?? "—";

  useEffect(() => {
    if (!canAccessDashboard) {
      setRangeChartCache({});
      return;
    }
    if (
      chart.data?.points &&
      chart.data.points.length >= 2 &&
      chart.data.source !== "synthetic"
    ) {
      setRangeChartCache((prev) => ({
        ...prev,
        [range]: chart.data,
      }));
    }
  }, [canAccessDashboard, chart.data, range]);

  const syntheticChart = useMemo(() => buildSyntheticChart(range, price), [price, range]);
  const cachedChartForRange = rangeChartCache[range] ?? null;
  const displayChart =
    chart.data?.points && chart.data.points.length >= 2
      ? chart.data
      : cachedChartForRange ?? syntheticChart;
  const chartPoints = displayChart?.points;
  const chartShape = useMemo(() => buildChart(chartPoints ?? []), [chartPoints]);
  const firstPrice = chartPoints?.[0]?.p ?? null;
  const lastPrice = chartPoints?.[chartPoints.length - 1]?.p ?? null;
  const chartStartTs = chartPoints?.[0]?.t ?? null;
  const chartEndTs = chartPoints?.[chartPoints.length - 1]?.t ?? null;
  const rangePerformance =
    firstPrice == null || lastPrice == null || firstPrice === 0
      ? null
      : ((lastPrice - firstPrice) / firstPrice) * 100;
  const rangeTone =
    rangePerformance == null
      ? "text-zinc-600"
      : rangePerformance >= 0
        ? "text-emerald-600"
        : "text-rose-600";

  const activePointIndex = useMemo(() => {
    if (!chartPoints || chartPoints.length === 0) return null;
    if (hoverIndex == null) return chartPoints.length - 1;
    if (hoverIndex < 0 || hoverIndex >= chartPoints.length) return chartPoints.length - 1;
    return hoverIndex;
  }, [chartPoints, hoverIndex]);

  const activePoint = activePointIndex == null ? null : chartPoints?.[activePointIndex] ?? null;
  const activeCoord = activePointIndex == null ? null : chartShape?.coords[activePointIndex] ?? null;
  const activePointDelta =
    activePoint == null || firstPrice == null || firstPrice === 0
      ? null
      : ((activePoint.p - firstPrice) / firstPrice) * 100;
  const activeDeltaTone =
    activePointDelta == null
      ? "text-zinc-600"
      : activePointDelta >= 0
        ? "text-emerald-600"
        : "text-rose-600";
  const rangeHigh = chartShape?.maxY ?? null;
  const rangeLow = chartShape?.minY ?? null;
  const volatilityPct =
    rangeHigh == null || rangeLow == null || firstPrice == null || firstPrice === 0
      ? null
      : ((rangeHigh - rangeLow) / firstPrice) * 100;
  const drawdownFromHigh =
    rangeHigh == null || activePoint == null || rangeHigh === 0
      ? null
      : ((activePoint.p - rangeHigh) / rangeHigh) * 100;
  const positionInRangePct =
    rangeHigh == null || rangeLow == null || activePoint == null || rangeHigh === rangeLow
      ? null
      : ((activePoint.p - rangeLow) / (rangeHigh - rangeLow)) * 100;
  const sentimentZone =
    fngValue == null ? "Unknown" : fngValue < 25 ? "Risk-Off" : fngValue < 55 ? "Neutral" : "Risk-On";
  const sentimentStrength =
    fngValue == null ? null : Math.min(100, Math.abs(fngValue - 50) * 2);
  const sentimentStrengthLabel =
    sentimentStrength == null ? "N/A" : sentimentStrength < 25 ? "Low conviction" : sentimentStrength < 60 ? "Medium conviction" : "High conviction";
  const fngUpdatedText =
    fngTimestamp == null
      ? "—"
      : new Date(fngTimestamp * 1000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  const aiUpdatedText =
    aiUpdatedAt == null
      ? "Not analyzed yet"
      : new Date(aiUpdatedAt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        });
  const sourceStatus = btcSource === "spot-fallback" ? "Fallback Source" : "Primary Source";
  const sourceDotClass = btcSource === "spot-fallback" ? "status-dot-fallback" : "status-dot-live";
  const aiFreshness = formatRelativeAiTime(aiUpdatedAt);
  const sentimentGaugeDeg =
    fngValue == null ? 0 : Math.max(0, Math.min(100, fngValue)) * 3.6;
  const halvingCountdown = cycle.data?.daysToNextHalving ?? null;
  const daysSinceHalving = cycle.data?.daysSinceLastHalving ?? null;
  const cycleProgress = cycle.data?.cycleProgressPct ?? null;
  const dominance = cycle.data?.btcDominance ?? null;
  const cycleUpdatedText =
    cycle.data?.ts == null
      ? "—"
      : new Date(cycle.data.ts).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
  const dominanceTone =
    dominance == null
      ? "text-zinc-700"
      : dominance >= 55
        ? "value-up"
        : dominance <= 45
        ? "value-down"
          : "text-zinc-700";
  const myCoinAmountNum = Number(myCoinAmount);
  const myCoinEntryNum = Number(myCoinEntry);
  const hasMyCoinAmount = Number.isFinite(myCoinAmountNum) && myCoinAmountNum > 0;
  const hasMyCoinEntry = Number.isFinite(myCoinEntryNum) && myCoinEntryNum > 0;
  const myCoinValue = hasMyCoinAmount && price != null ? myCoinAmountNum * price : null;
  const myCoinCost = hasMyCoinAmount && hasMyCoinEntry ? myCoinAmountNum * myCoinEntryNum : null;
  const myCoinPnl =
    myCoinValue != null && myCoinCost != null
      ? myCoinValue - myCoinCost
      : null;
  const myCoinPnlPct =
    myCoinPnl != null && myCoinCost != null && myCoinCost !== 0
      ? (myCoinPnl / myCoinCost) * 100
      : null;
  const myCoinPnlTone =
    myCoinPnl == null
      ? "text-zinc-600"
      : myCoinPnl >= 0
        ? "value-up"
        : "value-down";
  const demoHeadline = useMemo(
    () =>
      buildDemoHeadline({
        price,
        dailyChange: effective24hChange,
        sentimentLabel: fngLabel,
      }),
    [effective24hChange, fngLabel, price]
  );

  const chartTicks = useMemo(() => {
    if (!chartStartTs || !chartEndTs) return [];
    const tickCount = range === "24h" ? 5 : 4;
    const step = (chartEndTs - chartStartTs) / (tickCount - 1);
    return Array.from({ length: tickCount }, (_, idx) => chartStartTs + step * idx);
  }, [chartEndTs, chartStartTs, range]);
  const chartYTicks = useMemo(() => {
    if (!chartShape) return [] as number[];
    const count = 5;
    const step = (chartShape.maxY - chartShape.minY) / (count - 1);
    return Array.from({ length: count }, (_, idx) => chartShape.maxY - step * idx);
  }, [chartShape]);
  const ma50Series = useMemo(() => movingAverage(chartPoints ?? [], 50), [chartPoints]);
  const ma200Series = useMemo(() => movingAverage(chartPoints ?? [], 200), [chartPoints]);
  const ma50Path = useMemo(() => buildPathFromSeries(ma50Series, chartShape), [ma50Series, chartShape]);
  const ma200Path = useMemo(() => buildPathFromSeries(ma200Series, chartShape), [ma200Series, chartShape]);
  const latestMA50 = useMemo(
    () => [...ma50Series].reverse().find((value) => value != null) ?? null,
    [ma50Series]
  );
  const latestMA200 = useMemo(
    () => [...ma200Series].reverse().find((value) => value != null) ?? null,
    [ma200Series]
  );
  const crossSignal = useMemo(() => {
    if (!chartPoints || chartPoints.length < 2) return null as null | { type: "golden" | "death"; t: number };
    for (let idx = chartPoints.length - 1; idx > 0; idx -= 1) {
      const prev50 = ma50Series[idx - 1];
      const prev200 = ma200Series[idx - 1];
      const curr50 = ma50Series[idx];
      const curr200 = ma200Series[idx];
      if (prev50 == null || prev200 == null || curr50 == null || curr200 == null) continue;
      if (prev50 <= prev200 && curr50 > curr200) {
        return { type: "golden" as const, t: chartPoints[idx].t };
      }
      if (prev50 >= prev200 && curr50 < curr200) {
        return { type: "death" as const, t: chartPoints[idx].t };
      }
    }
    return null;
  }, [chartPoints, ma200Series, ma50Series]);
  const crossSignalLabel =
    crossSignal == null
      ? "No cross"
      : crossSignal.type === "golden"
        ? "Golden Cross"
        : "Death Cross";
  const crossSignalTone =
    crossSignal == null
      ? "text-zinc-700"
      : crossSignal.type === "golden"
        ? "value-up"
        : "value-down";
  const syntheticFngHistory = useMemo(() => buildSyntheticFng(fngRange), [fngRange]);
  const displayFngHistory =
    fngHistory.data?.points && fngHistory.data.points.length >= 2
      ? fngHistory.data
      : syntheticFngHistory;
  const fngChartTicks = useMemo(() => {
    const points = displayFngHistory.points ?? [];
    if (points.length < 2) return [];
    const tickCount = 4;
    const start = points[0].t;
    const end = points[points.length - 1].t;
    const step = (end - start) / (tickCount - 1);
    return Array.from({ length: tickCount }, (_, idx) => start + step * idx);
  }, [displayFngHistory.points]);
  const fngYTicks = useMemo(() => [100, 75, 55, 25, 0], []);

  const updateHoverIndexFromClientX = (clientX: number, container: HTMLDivElement) => {
    if (!chartShape || !chartPoints || chartPoints.length === 0) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = clientX - rect.left;
    const clampedRelX = Math.min(Math.max(relX, 0), rect.width);
    const svgX = (clampedRelX / rect.width) * chartShape.width;
    const clampedSvgX = Math.min(
      Math.max(svgX, chartShape.padX),
      chartShape.width - chartShape.padX
    );
    const normalizedX =
      (clampedSvgX - chartShape.padX) /
      (chartShape.width - chartShape.padX * 2);
    const targetTs = chartShape.minX + normalizedX * (chartShape.maxX - chartShape.minX);
    const nearest = findNearestPointIndex(chartPoints, targetTs);
    if (nearest >= 0) {
      setHoverIndex((prev) => (prev === nearest ? prev : nearest));
    }
  };

  const handleChartTouch = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    updateHoverIndexFromClientX(touch.clientX, event.currentTarget);
  };

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsSplashFading(true), 3000);
    const hideTimer = setTimeout(() => setShowSplash(false), 3600);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (showSplash) {
      setIsPageVisible(false);
      return;
    }
    const timer = setTimeout(() => setIsPageVisible(true), 40);
    return () => clearTimeout(timer);
  }, [showSplash]);

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = (await res.json()) as SessionPayload;
        if (cancelled) return;
        if (res.ok && data.authenticated) {
          setIsAuthenticated(true);
          setSessionUsername(data.username ?? null);
        } else {
          setIsAuthenticated(false);
          setSessionUsername(null);
        }
      } catch {
        if (!cancelled) {
          setIsAuthenticated(false);
          setSessionUsername(null);
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canAccessDashboard) return;
    const sectionIds: SectionKey[] = ["overview", "btc-metrics", "sentiment", "cycle", "chart", "controls"];
    const elements = sectionIds
      .map((id) => ({ id, el: document.getElementById(id) }))
      .filter((item): item is { id: SectionKey; el: HTMLElement } => item.el instanceof HTMLElement);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const next = visible.target.id as SectionKey;
        setActiveSection(next);
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0.2, 0.4, 0.7],
      }
    );

    elements.forEach((item) => observer.observe(item.el));
    return () => observer.disconnect();
  }, [canAccessDashboard]);

  useEffect(() => {
    if (isDemoMode) {
      setDisplayedAiHeadline(demoHeadline);
      setIsTypingAiHeadline(false);
      return;
    }
    if (!aiInsight) {
      setDisplayedAiHeadline(AI_DEFAULT_HEADLINE);
      setIsTypingAiHeadline(false);
      return;
    }

    setDisplayedAiHeadline("");
    setIsTypingAiHeadline(true);
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setDisplayedAiHeadline(aiInsight.slice(0, index));
      if (index >= aiInsight.length) {
        clearInterval(timer);
        setIsTypingAiHeadline(false);
      }
    }, 45);

    return () => clearInterval(timer);
  }, [aiInsight, demoHeadline, isDemoMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    if (price == null) return;
    const previous = previousPriceRef.current;
    if (previous != null && price !== previous) {
      setPricePulse(price > previous ? "up" : "down");
      const timer = setTimeout(() => setPricePulse(null), 650);
      previousPriceRef.current = price;
      return () => clearTimeout(timer);
    }
    previousPriceRef.current = price;
    return;
  }, [price]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      MY_COIN_STORAGE_KEY,
      JSON.stringify({ amount: myCoinAmount, entry: myCoinEntry })
    );
  }, [myCoinAmount, myCoinEntry]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setLoginIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Login failed");
      }
      setIsAuthenticated(true);
      setIsDemoMode(false);
      setSessionUsername(payload?.username ?? loginUsername);
      setLoginPassword("");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoginIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (isAuthenticated) {
        await fetch("/api/auth/logout", { method: "POST" });
      }
    } finally {
      setIsAuthenticated(false);
      setIsDemoMode(false);
      setSessionUsername(null);
      setActiveSection("overview");
    }
  };

  const handleAnalyze = async () => {
    if (isDemoMode) return;
    setAiError(null);
    setAiIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price,
          dailyChange: effective24hChange,
          sentiment: fngValue,
          sentimentLabel: fngLabel,
          range,
          rangeReturn: rangePerformance,
          source: btcSource,
        }),
      });

      const payload = await res.json();
      if (!res.ok || !payload?.headline) {
        throw new Error(payload?.error ?? `Request failed: ${res.status}`);
      }

      setAiInsight(String(payload.headline));
      setAiUpdatedAt(Date.now());
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setAiIsAnalyzing(false);
    }
  };

  const handleNavClick = (sectionId: SectionKey) => {
    if (typeof document === "undefined") return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveSection(sectionId);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${sectionId}`);
    }
  };

  if (showSplash) {
    return (
      <main
        className={`min-h-screen bg-[radial-gradient(circle_at_18%_12%,rgba(180,83,9,0.9),rgba(41,22,8,0.96)_42%,rgba(18,11,2,1)_100%)] px-4 py-6 text-amber-100 transition-opacity duration-600 sm:px-6 lg:px-8 ${
          isSplashFading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="mx-auto flex min-h-[82vh] max-w-2xl flex-col items-center justify-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300/90">BTC Tracker</p>
          <h1 className="mt-4 text-6xl font-black tracking-tight text-amber-200 sm:text-7xl">Momentum</h1>
          <p className="mt-3 text-sm text-amber-100/85 sm:text-base">Reading price, sentiment and cycle signals...</p>
          <div className="mt-7 inline-flex items-center gap-3 rounded-full border border-amber-500/35 bg-black/35 px-4 py-2 text-sm font-semibold text-amber-200">
            <span className="spinner-wheel h-5 w-5 rounded-full border-2 border-amber-200 border-t-transparent border-r-transparent" />
            Loading dashboard
          </div>
        </div>
      </main>
    );
  }

  if (!authChecked) {
    return (
      <main
        className={`min-h-screen px-4 py-6 transition-all duration-700 sm:px-6 lg:px-8 ${
          isPageVisible ? "opacity-100" : "opacity-0"
        } ${
          isDarkMode
            ? "bg-[radial-gradient(circle_at_18%_12%,rgba(180,83,9,0.9),rgba(41,22,8,0.96)_42%,rgba(18,11,2,1)_100%)] text-amber-100"
            : "bg-[radial-gradient(circle_at_15%_10%,rgba(196,242,165,0.55),rgba(244,252,210,0.65)_38%,rgba(241,247,223,0.85)_70%,rgba(234,242,210,0.95)_100%)] text-zinc-950"
        }`}
      >
        <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center">
          <div className="ui-card w-full p-5 text-center">
            <p className="text-sm ui-soft">Checking session...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!canAccessDashboard) {
    return (
      <main
        className={`relative min-h-screen px-4 py-6 transition-all duration-700 sm:px-6 lg:px-8 ${
          isPageVisible ? "opacity-100" : "opacity-0"
        } ${
          isDarkMode
            ? "bg-[radial-gradient(circle_at_18%_12%,rgba(180,83,9,0.9),rgba(41,22,8,0.96)_42%,rgba(18,11,2,1)_100%)] text-amber-100"
            : "bg-[radial-gradient(circle_at_15%_10%,rgba(196,242,165,0.55),rgba(244,252,210,0.65)_38%,rgba(241,247,223,0.85)_70%,rgba(234,242,210,0.95)_100%)] text-zinc-950"
        }`}
      >
        <div className="mx-auto flex min-h-[78vh] max-w-md items-center justify-center">
          <form onSubmit={handleLogin} className="ui-card w-full space-y-4 p-5 sm:p-6">
            <div>
              <p className="text-lg font-semibold text-zinc-900">Login</p>
              <p className="text-xs ui-soft"></p>
            </div>
            <label className="block text-xs ui-soft">
              Username
              <input
                type="text"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                autoComplete="username"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-amber-500"
              />
            </label>
            <label className="block text-xs ui-soft">
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-amber-500"
              />
            </label>
            {loginError && <p className="text-xs text-rose-700">{loginError}</p>}
            <button
              type="submit"
              disabled={loginIsSubmitting}
              className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginIsSubmitting ? "Logging in..." : "Login"}
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginError(null);
                setIsDemoMode(true);
              }}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
            >
              Demo
            </button>
            <p className="text-[11px] ui-soft"></p>
          </form>
        </div>
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-2xl border border-amber-500/35 bg-black/35 px-4 py-3 text-right backdrop-blur sm:bottom-6 sm:right-6">
          <div className="inline-flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-sm font-black text-zinc-950">
              M
            </span>
            <p className="text-base font-black tracking-tight text-amber-200">Momentum</p>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-amber-300/85">Bitcoin Signal Desk</p>
          <p className="mt-1 text-xs text-amber-100/75">Price, sentiment and cycle intelligence.</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`min-h-screen px-4 py-6 text-zinc-950 transition-all duration-700 sm:px-6 lg:px-8 ${
        isPageVisible ? "opacity-100" : "opacity-0"
      } ${
        isDarkMode
          ? "bg-[radial-gradient(circle_at_18%_12%,rgba(180,83,9,0.9),rgba(41,22,8,0.96)_42%,rgba(18,11,2,1)_100%)] text-amber-100"
          : "bg-[radial-gradient(circle_at_15%_10%,rgba(196,242,165,0.55),rgba(244,252,210,0.65)_38%,rgba(241,247,223,0.85)_70%,rgba(234,242,210,0.95)_100%)] text-zinc-950"
      }`}
    >
      <div className="mx-auto w-full max-w-7xl lg:grid lg:grid-cols-[220px_1fr] lg:gap-4">
        <aside className="hidden lg:block">
          <div className="ui-card sticky top-4 p-3 card-enter" style={{ "--stagger": "40ms" } as CSSProperties}>
            <p className="px-2 text-xs font-semibold uppercase tracking-wide ui-soft">Navigation</p>
            <nav className="mt-2 space-y-1">
              {[
                { id: "overview", label: "Overview" },
                { id: "btc-metrics", label: "BTC Metrics" },
                { id: "sentiment", label: "Sentiment" },
                { id: "cycle", label: "Cycle Position" },
                { id: "chart", label: "Price Chart" },
                { id: "controls", label: "Controls" },
              ].map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    handleNavClick(item.id as SectionKey);
                  }}
                    className={`flex items-center justify-between rounded-lg px-2 py-2 text-sm transition ${
                    activeSection === item.id
                      ? "bg-amber-500 text-zinc-950"
                      : "text-amber-100/90 hover:bg-amber-300/10"
                  }`}
                >
                  <span>{item.label}</span>
                  {activeSection === item.id && <span className="text-[10px] uppercase">Live</span>}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="space-y-4">
          <header id="overview" className="ui-card card-enter scroll-mt-4 p-4 sm:p-5" style={{ "--stagger": "80ms" } as CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300/90">Momentum</p>
                <h1 className="mt-1 text-4xl font-black tracking-tight text-amber-100 sm:text-5xl">Momentum</h1>
                <p className="mt-1 text-base font-semibold text-amber-50">
                  {isDemoMode ? "Welcome, please have a look around" : "Welcome, Chris."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="status-badge">
                  <span className={`status-dot ${isRefreshing ? "status-dot-live" : ""}`} />
                  {isRefreshing ? "Refreshing" : "Idle"}
                </span>
                <span className="status-badge">
                  <span className="status-dot status-dot-live" />
                  Live
                </span>
                <span className="status-badge">
                  <span className={`status-dot ${sourceDotClass}`} />
                  {sourceStatus}
                </span>
                <span className="status-badge">
                  <span className="status-dot status-dot-ai" />
                  {aiFreshness}
                </span>
                <span className="status-badge">@{isDemoMode ? "demo" : sessionUsername ?? "user"}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-amber-500/45 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/20"
                >
                  {isDemoMode ? "Exit demo" : "Logout"}
                </button>
              </div>
            </div>
            <div className="mt-2 text-xs ui-soft">Updated {lastUpdated}</div>
            <div
              className={`mt-4 rounded-xl border px-4 py-3 ${
                isDarkMode
                  ? "border-amber-500/35 bg-[linear-gradient(115deg,rgba(57,35,7,0.92),rgba(33,18,5,0.95))]"
                  : "border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                  AI Price Reflection
                </p>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={aiIsAnalyzing || isDemoMode}
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                    isDarkMode
                      ? "border-amber-500/45 bg-amber-500 text-zinc-950 hover:bg-amber-400"
                      : "border-amber-200 bg-white text-amber-700 hover:bg-amber-50"
                  } ${
                    aiIsAnalyzing ? "analyze-button-loading" : ""
                  }`}
                >
                  {isDemoMode ? (
                    "Demo mode"
                  ) : aiIsAnalyzing ? (
                    <span className="inline-flex items-center gap-1">
                      Thinking
                      <span className="thinking-dots" aria-hidden>
                        <span>.</span>
                        <span>.</span>
                        <span>.</span>
                      </span>
                    </span>
                  ) : (
                    "Analyse"
                  )}
                </button>
              </div>
              <p className="mt-1 text-2xl font-semibold leading-snug text-amber-100 sm:text-3xl">
                {displayedAiHeadline}
                {isTypingAiHeadline && <span className="typing-caret" aria-hidden />}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100/70">
                <span>Last AI run: {aiUpdatedText}</span>
                {isDemoMode ? (
                  <span>AI analysis disabled in demo</span>
                ) : (
                  aiInsight == null && <span>Click Analyse to use OpenAI API</span>
                )}
              </div>
              {aiError && <p className="mt-2 text-xs text-rose-700">Analysis failed: {aiError}</p>}
            </div>
          </header>

          <div className="lg:hidden -mx-1 overflow-x-auto px-1">
            <div className="flex w-max gap-2 py-1">
              <div className="ui-card min-w-[150px] px-3 py-2 text-sm card-enter" style={{ "--stagger": "120ms" } as CSSProperties}>
                <p className="text-[11px] ui-soft">Price</p>
                <p className={`mt-1 font-semibold ${btc.isValidating ? "data-refreshing" : ""}`}>
                  {price == null ? "—" : formatUsd(price)}
                </p>
              </div>
              <div className="ui-card min-w-[130px] px-3 py-2 text-sm card-enter" style={{ "--stagger": "150ms" } as CSSProperties}>
                <p className="text-[11px] ui-soft">24h</p>
                <p className={`mt-1 font-semibold ${changeTone}`}>{formatSignedPercent(effective24hChange)}</p>
              </div>
              <div className="ui-card min-w-[130px] px-3 py-2 text-sm card-enter" style={{ "--stagger": "180ms" } as CSSProperties}>
                <p className="text-[11px] ui-soft">Sentiment</p>
                <p className="mt-1 font-semibold">{fngValue ?? "—"}</p>
              </div>
              <div className="ui-card min-w-[150px] px-3 py-2 text-sm card-enter" style={{ "--stagger": "210ms" } as CSSProperties}>
                <p className="text-[11px] ui-soft">Source</p>
                <p className="mt-1 font-semibold">{btcSource}</p>
              </div>
            </div>
          </div>

          <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <article id="btc-metrics" className="ui-card card-enter scroll-mt-4 p-5 sm:p-6" style={{ "--stagger": "120ms" } as CSSProperties}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide ui-soft">BTC Metrics</p>
                  <p className="text-sm ui-soft">BTC Price</p>
                  <p className={`mt-2 text-4xl font-semibold tracking-tight transition-all duration-500 sm:text-5xl ${btc.isValidating ? "data-refreshing" : ""} ${pricePulse === "up" ? "price-pulse-up" : ""} ${pricePulse === "down" ? "price-pulse-down" : ""}`}>
                    {price == null ? "Loading..." : formatUsd(price)}
                  </p>
                  <p className={`mt-2 text-sm font-medium ${changeTone}`}>
                    24h change {formatSignedPercent(effective24hChange)}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs ui-soft">
                  Provider: {btcSource}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs ui-soft">Range Volatility</p>
                  <p className="mt-1 text-sm font-semibold">{formatSignedPercent(volatilityPct)}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs ui-soft">Drawdown From High</p>
                  <p className="mt-1 text-sm font-semibold">{formatSignedPercent(drawdownFromHigh)}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs ui-soft">Position In Range</p>
                  <p className="mt-1 text-sm font-semibold">
                    {positionInRangePct == null ? "N/A" : `${positionInRangePct.toFixed(1)}%`}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs ui-soft">Tracking Window</p>
                  <p className="mt-1 text-sm font-semibold">{range.toUpperCase()}</p>
                </div>
              </div>

              {btc.error && (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Failed to load BTC price. Try manual refresh.
                </p>
              )}
            </article>

            <article id="sentiment" className="ui-card card-enter scroll-mt-4 p-5 sm:p-6" style={{ "--stagger": "160ms" } as CSSProperties}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide ui-soft">Sentiment</p>
                  <p className="text-sm ui-soft">Fear & Greed Index</p>
                  <p className={`mt-2 text-4xl font-semibold tracking-tight sm:text-5xl ${fng.isValidating ? "data-refreshing" : ""}`}>
                    {fngValue == null ? "Loading..." : fngValue}
                  </p>
                  <p className={`mt-2 text-sm ${sentimentLabelTone}`}>{fngLabel ?? "Classification unavailable"}</p>
                </div>
                <div className={`rounded-2xl bg-gradient-to-br px-3 py-2 text-xs font-medium shadow-inner ${moodTone}`}>
                  Regime
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4">
                <div className="relative h-28 w-28 shrink-0">
                  <div
                    className="h-full w-full rounded-full"
                    style={{
                      background: `conic-gradient(#f59e0b ${sentimentGaugeDeg}deg, #e4e4e7 ${sentimentGaugeDeg}deg)`,
                    }}
                  />
                  <div className="absolute inset-2 flex items-center justify-center rounded-full bg-white text-center">
                    <div>
                      <p className="text-lg font-semibold leading-none">{fngValue ?? "—"}</p>
                      <p className="mt-1 text-[10px] ui-soft">F&G</p>
                    </div>
                  </div>
                </div>
                <div className="grid flex-1 gap-2 text-xs">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2">
                    <span className="ui-soft">Zone: </span>
                    <span className="font-semibold">{sentimentZone}</span>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2">
                    <span className="ui-soft">Conviction: </span>
                    <span className="font-semibold">{sentimentStrengthLabel}</span>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2">
                    <span className="ui-soft">Updated: </span>
                    <span className="font-semibold">{fngUpdatedText}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <div className="flex items-center justify-between text-xs text-zinc-600">
                  <span>Regime Strength</span>
                  <span>{sentimentStrength == null ? "N/A" : `${sentimentStrength.toFixed(0)} / 100`}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-400 transition-all duration-700"
                    style={{ width: `${sentimentStrength ?? 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs ui-soft">Source: {fngSource}</p>
              </div>

              {fng.error && (
                <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Failed to load Fear & Greed.
                </p>
              )}
            </article>
          </section>

          <section id="cycle" className="ui-card card-enter scroll-mt-4 p-5 sm:p-6" style={{ "--stagger": "185ms" } as CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm ui-soft">Cycle Position Indicator</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">Macro cycle dashboard</p>
              </div>
              <span className="status-badge">
                <span className={`status-dot ${cycle.data?.dominanceSource === "unavailable" ? "status-dot-fallback" : "status-dot-live"}`} />
                Dominance: {cycle.data?.dominanceSource ?? "—"}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <p className="text-xs ui-soft">Halving Countdown</p>
                <p className="mt-1 text-xl font-semibold text-zinc-900">
                  {halvingCountdown == null ? "—" : `${halvingCountdown}d`}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <p className="text-xs ui-soft">Days Since Last Halving</p>
                <p className="mt-1 text-xl font-semibold text-zinc-900">
                  {daysSinceHalving == null ? "—" : `${daysSinceHalving}d`}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <p className="text-xs ui-soft">Position In 4Y Cycle</p>
                <p className="mt-1 text-xl font-semibold text-zinc-900">
                  {cycleProgress == null ? "—" : `${cycleProgress.toFixed(1)}%`}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-400 transition-all duration-700"
                    style={{ width: `${cycleProgress ?? 0}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                <p className="text-xs ui-soft">BTC Dominance</p>
                <p className={`mt-1 text-xl font-semibold ${dominanceTone}`}>
                  {dominance == null ? "—" : `${dominance.toFixed(2)}%`}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs ui-soft">
              Updated {cycleUpdatedText}
            </p>
          </section>

          <section id="chart" className="ui-card card-enter scroll-mt-4 p-4 sm:p-4" style={{ "--stagger": "220ms" } as CSSProperties}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm ui-soft">BTC Price Chart</p>
                <p className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Historical performance</p>
              </div>
              <p className="text-xs ui-soft">
                Source: {displayChart?.source ?? "—"}
                {chart.error && cachedChartForRange ? " (showing previous valid data)" : ""}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="status-badge">
                <span className="status-dot status-dot-live" />
                Price line
              </span>
              <span className="status-badge">
                <span className="status-dot status-dot-ai" />
                Area trend
              </span>
              <span className="status-badge">
                <span className="status-dot" style={{ background: "#fbbf24" }} />
                50 MA
              </span>
              <span className="status-badge">
                <span className="status-dot" style={{ background: "#d97706" }} />
                200 MA
              </span>
              <span className="status-badge">
                <span className="status-dot status-dot-fallback" />
                Hover: {activePoint == null ? "—" : formatUsd(activePoint.p)}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {RANGE_OPTIONS.map((option) => {
                const active = option.key === range;
                return (
                  <button
                    key={option.key}
                    className={`rounded-xl border px-3 py-1.5 text-sm transition ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                    onClick={() => {
                      setHoverIndex(null);
                      setRange(option.key);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="ui-soft">Range Return</p>
                <p className={`mt-1 font-semibold ${rangeTone}`}>{formatSignedPercent(rangePerformance)}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="ui-soft">Range High</p>
                <p className="mt-1 font-semibold text-zinc-900">{chartShape ? formatUsd(chartShape.maxY) : "—"}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="ui-soft">Range Low</p>
                <p className="mt-1 font-semibold text-zinc-900">{chartShape ? formatUsd(chartShape.minY) : "—"}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="ui-soft">50 / 200 MA</p>
                <p className="mt-1 font-semibold text-zinc-900">
                  {latestMA50 == null || latestMA200 == null
                    ? "—"
                    : `${formatUsd(latestMA50)} / ${formatUsd(latestMA200)}`}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="ui-soft">Cross Alert</p>
                <p className={`mt-1 font-semibold ${crossSignalTone}`}>{crossSignalLabel}</p>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ui-soft">Hovered point</span>
                <span className={activeDeltaTone}>
                  {activePointDelta == null ? "N/A" : formatSignedPercent(activePointDelta)} vs start
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-zinc-900">{activePoint == null ? "—" : formatUsd(activePoint.p)}</span>
                <span className="text-xs ui-soft">{activePoint == null ? "—" : formatChartDate(activePoint.t, range)}</span>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 sm:p-4">
              {chart.isLoading && !chartShape && <p className="py-14 text-center text-sm ui-soft">Loading chart...</p>}
              {!chartShape && !chart.isLoading && (
                <p className="py-14 text-center text-sm text-rose-700">Failed to load chart data.</p>
              )}
              {chartShape && (
                <>
                  {chart.error && (
                    <p className="mb-2 text-xs text-amber-700">
                      Live update failed; showing last valid chart data.
                    </p>
                  )}
                  <div
                    className="relative h-[305px] w-full sm:h-[292px]"
                    onMouseLeave={() => setHoverIndex(null)}
                    onMouseMove={(event) => {
                      updateHoverIndexFromClientX(event.clientX, event.currentTarget);
                    }}
                    onTouchStart={handleChartTouch}
                    onTouchMove={handleChartTouch}
                    style={{
                      touchAction: "pan-y",
                    }}
                  >
                    <svg
                      viewBox={`0 0 ${chartShape.width} ${chartShape.height}`}
                      preserveAspectRatio="none"
                      className="h-full w-full"
                    >
                      <defs>
                        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.24" />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.01" />
                        </linearGradient>
                      </defs>
                      {Array.from({ length: 4 }, (_, i) => {
                        const y = chartShape.padY + ((chartShape.height - chartShape.padY * 2) / 3) * i;
                        return (
                          <line
                            key={`grid-${i}`}
                            x1={chartShape.padX}
                            y1={y}
                            x2={chartShape.width - chartShape.padX}
                            y2={y}
                            stroke="#d4d4d8"
                            strokeWidth="1"
                            strokeDasharray="2 8"
                            opacity="0.9"
                          />
                        );
                      })}
                      <path d={chartShape.area} fill="url(#chartFill)" />
                      <path d={chartShape.path} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                      {ma50Path && (
                        <path
                          d={ma50Path}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          opacity="0.9"
                        />
                      )}
                      {ma200Path && (
                        <path
                          d={ma200Path}
                          fill="none"
                          stroke="#d97706"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          opacity="0.85"
                        />
                      )}
                      {activeCoord && (
                        <>
                          <line
                            x1={activeCoord.x}
                            y1={chartShape.padY}
                            x2={activeCoord.x}
                            y2={chartShape.height - chartShape.padY}
                            stroke="#78350f"
                            strokeWidth="1.5"
                            strokeDasharray="6 6"
                            opacity="0.35"
                          />
                          <line
                            x1={chartShape.padX}
                            y1={activeCoord.y}
                            x2={chartShape.width - chartShape.padX}
                            y2={activeCoord.y}
                            stroke="#78350f"
                            strokeWidth="1.5"
                            strokeDasharray="4 6"
                            opacity="0.2"
                          />
                          <circle cx={activeCoord.x} cy={activeCoord.y} r="8" fill="#fbbf24" opacity="0.2" />
                          <circle cx={activeCoord.x} cy={activeCoord.y} r="4.5" fill="#f59e0b" />
                          <circle cx={activeCoord.x} cy={activeCoord.y} r="2.2" fill="#fffbeb" />
                        </>
                      )}
                    </svg>
                    {activePoint && activeCoord && (
                      <div
                        className={`pointer-events-none absolute z-10 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur ${
                          isDarkMode
                            ? "border-amber-800/60 bg-zinc-950/95 text-zinc-100"
                            : "border-zinc-200 bg-white/95 text-zinc-900"
                        }`}
                        style={{
                          left: `${(activeCoord.x / chartShape.width) * 100}%`,
                          top: `${(activeCoord.y / chartShape.height) * 100}%`,
                          transform: "translate(-50%, -120%)",
                        }}
                      >
                        <div className="font-semibold">{formatUsd(activePoint.p)}</div>
                        <div className="mt-0.5 ui-soft">{formatChartDate(activePoint.t, range)}</div>
                        <div className={`mt-0.5 ${activeDeltaTone}`}>
                          {activePointDelta == null ? "N/A" : formatSignedPercent(activePointDelta)}
                        </div>
                      </div>
                    )}
                    <div className="pointer-events-none absolute left-0 top-0 h-full w-24 bg-[linear-gradient(to_left,rgba(7,11,9,0)_0%,rgba(7,11,9,0.32)_28%,rgba(7,11,9,0.62)_62%,rgba(7,11,9,0.88)_100%)] backdrop-blur-[1px] sm:w-28" />
                    <div className="pointer-events-none absolute left-0 top-0 flex h-full w-24 flex-col justify-between pl-1.5 text-[10px] ui-soft sm:w-28 sm:pl-2 sm:text-[11px]">
                      {chartYTicks.map((tick, idx) => (
                        <span key={`${tick}-${idx}`} className="text-left tabular-nums">
                          {formatUsd(tick)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div
                    className="mt-2 grid gap-1 border-t border-zinc-200 pt-2 text-[11px] ui-soft"
                    style={{ gridTemplateColumns: `repeat(${chartTicks.length || 1}, minmax(0, 1fr))` }}
                  >
                    {chartTicks.map((tickTs, index) => (
                      <span
                        key={`${tickTs}-${index}`}
                        className={`${index === 0 ? "text-left" : index === chartTicks.length - 1 ? "text-right" : "text-center"}`}
                      >
                        {formatAxisTick(tickTs, range)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">Historical Fear & Greed Chart</p>
                  <p className="text-xs ui-soft">Source: {displayFngHistory.source ?? "—"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FNG_RANGE_OPTIONS.map((option) => {
                    const active = option.key === fngRange;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setFngRange(option.key)}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          active
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  Fear (0-25)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  Neutral (26-54)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                  Greed (55-74)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  Extreme Greed (75-100)
                </span>
              </div>
              {fngHistory.isLoading && <p className="py-10 text-center text-sm ui-soft">Loading F&G history...</p>}
              {!fngHistory.isLoading && (
                <div className="mt-3">
                  {fngHistory.error && (
                    <p className="mb-2 text-xs text-amber-700">
                      Live update failed; showing fallback F&G data.
                    </p>
                  )}
                  <div className="relative h-[250px] w-full sm:h-[230px]">
                    <svg viewBox="0 0 1000 180" preserveAspectRatio="none" className="h-full w-full">
                      {(() => {
                        const points = displayFngHistory.points ?? [];
                        if (points.length < 2) return null;
                        const minX = points[0].t;
                        const maxX = points[points.length - 1].t;
                        const xRange = Math.max(1, maxX - minX);
                        const padX = 12;
                        const padY = 10;
                        const height = 180;
                        const width = 1000;
                        const toX = (value: number) =>
                          padX + ((value - minX) / xRange) * (width - padX * 2);
                        const toY = (value: number) =>
                          height - padY - (Math.max(0, Math.min(100, value)) / 100) * (height - padY * 2);
                        const line = points
                          .map((point, idx) => `${idx === 0 ? "M" : "L"}${toX(point.t).toFixed(2)} ${toY(point.v).toFixed(2)}`)
                          .join(" ");
                        const area = `${line} L${toX(points[points.length - 1].t).toFixed(2)} ${(height - padY).toFixed(2)} L${toX(points[0].t).toFixed(2)} ${(height - padY).toFixed(2)} Z`;

                        return (
                          <>
                            <defs>
                              <linearGradient id="fngFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.04" />
                              </linearGradient>
                            </defs>
                            <rect x={padX} y={toY(100)} width={width - padX * 2} height={toY(75) - toY(100)} fill="#d97706" opacity="0.14" />
                            <rect x={padX} y={toY(75)} width={width - padX * 2} height={toY(55) - toY(75)} fill="#f59e0b" opacity="0.12" />
                            <rect x={padX} y={toY(55)} width={width - padX * 2} height={toY(25) - toY(55)} fill="#ca8a04" opacity="0.11" />
                            <rect x={padX} y={toY(25)} width={width - padX * 2} height={toY(0) - toY(25)} fill="#be123c" opacity="0.11" />
                            <path d={area} fill="url(#fngFill)" />
                            <path d={line} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
                          </>
                        );
                      })()}
                    </svg>
                    <div className="pointer-events-none absolute left-0 top-0 h-full w-16 bg-[linear-gradient(to_left,rgba(7,11,9,0)_0%,rgba(7,11,9,0.3)_28%,rgba(7,11,9,0.58)_62%,rgba(7,11,9,0.82)_100%)] backdrop-blur-[1px] sm:w-20" />
                    <div className="pointer-events-none absolute left-0 top-0 flex h-full w-16 flex-col justify-between pl-1.5 text-[10px] ui-soft sm:w-20 sm:pl-2 sm:text-[11px]">
                      {fngYTicks.map((tick) => (
                        <span key={`fng-y-${tick}`} className="text-left tabular-nums">
                          {tick}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div
                    className="mt-2 grid gap-1 border-t border-zinc-200 pt-2 text-[11px] ui-soft"
                    style={{ gridTemplateColumns: `repeat(${fngChartTicks.length || 1}, minmax(0, 1fr))` }}
                  >
                    {fngChartTicks.map((tickTs, index) => (
                      <span
                        key={`${tickTs}-${index}`}
                        className={`${index === 0 ? "text-left" : index === fngChartTicks.length - 1 ? "text-right" : "text-center"}`}
                      >
                        {formatAxisTick(tickTs, fngRange)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section id="controls" className="ui-card card-enter scroll-mt-4 p-4 sm:p-5" style={{ "--stagger": "260ms" } as CSSProperties}>
            <details className="sm:hidden group">
              <summary className="cursor-pointer list-none text-sm font-medium text-zinc-700">
                Manual controls
              </summary>
              <div className="mt-3 grid gap-2">
                <button
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={btc.isValidating}
                  onClick={() => btc.mutate()}
                >
                  {btc.isValidating ? "Refreshing BTC..." : "Refresh BTC now"}
                </button>
                <button
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={fng.isValidating}
                  onClick={() => fng.mutate()}
                >
                  {fng.isValidating ? "Refreshing F&G..." : "Refresh F&G now"}
                </button>
                <button
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={chart.isValidating}
                  onClick={() => {
                    setHoverIndex(null);
                    chart.mutate();
                  }}
                >
                  {chart.isValidating ? "Refreshing chart..." : "Refresh chart now"}
                </button>
              </div>
            </details>

            <div className="hidden sm:block">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm ui-soft">Manual controls</p>
                <p className="text-xs ui-soft">BTC 10s cadence | F&G 30m cadence</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={btc.isValidating}
                  onClick={() => btc.mutate()}
                >
                  {btc.isValidating ? "Refreshing BTC..." : "Refresh BTC now"}
                </button>
                <button
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={fng.isValidating}
                  onClick={() => fng.mutate()}
                >
                  {fng.isValidating ? "Refreshing F&G..." : "Refresh F&G now"}
                </button>
                <button
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={chart.isValidating}
                  onClick={() => {
                    setHoverIndex(null);
                    chart.mutate();
                  }}
                >
                  {chart.isValidating ? "Refreshing chart..." : "Refresh chart now"}
                </button>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900">My Coin (Local Storage)</p>
                <button
                  type="button"
                  onClick={() => {
                    setMyCoinAmount("");
                    setMyCoinEntry("");
                  }}
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  Clear
                </button>
              </div>
              <p className="mt-1 text-xs ui-soft">
                Saved locally in your browser only.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs ui-soft">
                  Coin amount
                  <input
                    type="number"
                    min="0"
                    step="0.00000001"
                    value={myCoinAmount}
                    onChange={(event) => setMyCoinAmount(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-amber-500"
                    placeholder="e.g. 0.25"
                  />
                </label>
                <label className="text-xs ui-soft">
                  Avg entry (USD)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={myCoinEntry}
                    onChange={(event) => setMyCoinEntry(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-amber-500"
                    placeholder="e.g. 54000"
                  />
                </label>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-200 bg-white px-2 py-2">
                  <p className="ui-soft">Position Value</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {myCoinValue == null ? "—" : formatUsd(myCoinValue)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white px-2 py-2">
                  <p className="ui-soft">Cost Basis</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {myCoinCost == null ? "—" : formatUsd(myCoinCost)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white px-2 py-2">
                  <p className="ui-soft">P&L</p>
                  <p className={`mt-1 text-sm font-semibold ${myCoinPnlTone}`}>
                    {myCoinPnl == null ? "—" : `${formatUsd(myCoinPnl)} (${formatSignedPercent(myCoinPnlPct)})`}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
