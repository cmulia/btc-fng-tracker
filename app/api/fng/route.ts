import { NextResponse } from "next/server";

export async function GET() {
  const url = "https://api.alternative.me/fng/?limit=1&format=json";

  const res = await fetch(url, {
    headers: { "accept": "application/json" },
    // Always fetch fresh data so manual refresh in the UI is immediate.
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch Fear & Greed" }, { status: 500 });
  }

  const data = await res.json();
  const item = data?.data?.[0];

  return NextResponse.json(
    {
      value: item?.value ? Number(item.value) : null,
      label: item?.value_classification ?? null,
      timestamp: item?.timestamp ? Number(item.timestamp) : null,
      source: "alternative.me",
      ts: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
