import { NextResponse } from "next/server";

type AnalyzeBody = {
  price?: number | null;
  dailyChange?: number | null;
  sentiment?: number | null;
  sentimentLabel?: string | null;
  range?: string | null;
  rangeReturn?: number | null;
  source?: string | null;
};

type ResponseJson = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

function toResponseJson(value: unknown): ResponseJson {
  if (typeof value !== "object" || value == null) return {};
  return value as ResponseJson;
}

function extractHeadline(responseJson: ResponseJson): string | null {
  const direct = responseJson.output_text;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const output = responseJson.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const chunk of content) {
        const text = chunk?.text;
        if (typeof text === "string" && text.trim()) {
          return text.trim();
        }
      }
    }
  }
  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payloadSummary = {
    price: body.price ?? null,
    daily_change_pct: body.dailyChange ?? null,
    sentiment_value: body.sentiment ?? null,
    sentiment_label: body.sentimentLabel ?? null,
    selected_range: body.range ?? null,
    range_return_pct: body.rangeReturn ?? null,
    source: body.source ?? null,
  };

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const input = [
    {
      role: "system",
      content:
        "You are a crypto market analyst. Return exactly one sentence, plain text, no markdown, max 32 words. Do not repeat dashboard metrics or numbers (no $, %, or quoted values). Give only: interpretation, one cautious action, and one brief risk caveat.",
    },
    {
      role: "user",
      content: `From this BTC snapshot, give a non-obvious interpretation that is not already visible on the dashboard, plus one cautious action and a short caveat: ${JSON.stringify(payloadSummary)}.`,
    },
  ];

  const openAiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: 80,
    }),
    cache: "no-store",
  });

  if (!openAiRes.ok) {
    const errorText = await openAiRes.text();
    return NextResponse.json(
      { error: `OpenAI request failed (${openAiRes.status}): ${errorText.slice(0, 200)}` },
      { status: 502 }
    );
  }

  const responseJson = toResponseJson(await openAiRes.json());
  const headline = extractHeadline(responseJson);
  if (!headline) {
    return NextResponse.json(
      { error: "No analysis text returned by OpenAI" },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { headline, model, ts: Date.now() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
