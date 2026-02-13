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

type SnapshotSummary = {
  price: number | null;
  daily_change_pct: number | null;
  sentiment_value: number | null;
  sentiment_label: string | null;
  selected_range: string | null;
  range_return_pct: number | null;
  source: string | null;
};

type ResponseJson = {
  id?: string;
  output_text?: string | string[];
  output?: Array<{
    content?: Array<{
      text?: string | { value?: string };
      type?: string;
      value?: string;
    }>;
  }>;
  content?: Array<{
    text?: string | { value?: string };
    value?: string;
  }>;
};

function toResponseJson(value: unknown): ResponseJson {
  if (typeof value !== "object" || value == null) return {};
  return value as ResponseJson;
}

function extractHeadline(responseJson: ResponseJson): string | null {
  const looksLikeObjectId = (value: string) =>
    /^(resp|rs|msg|run|evt)_[a-z0-9]+$/i.test(value.trim());
  const isUsableSentence = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (looksLikeObjectId(trimmed)) return false;
    if (trimmed.length < 20) return false;
    if (!/[a-zA-Z]/.test(trimmed)) return false;
    if (!/\s/.test(trimmed)) return false;
    return true;
  };

  const direct = responseJson.output_text;
  if (Array.isArray(direct)) {
    const joined = direct.join(" ").trim();
    if (isUsableSentence(joined)) return joined;
  } else if (typeof direct === "string" && isUsableSentence(direct)) {
    return direct.trim();
  }

  const extractText = (value: unknown): string | null => {
    if (typeof value === "string" && isUsableSentence(value)) return value.trim();
    if (typeof value === "object" && value != null) {
      const maybeValue = (value as { value?: unknown }).value;
      if (typeof maybeValue === "string" && isUsableSentence(maybeValue)) {
        return maybeValue.trim();
      }
    }
    return null;
  };

  const output = responseJson.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const chunk of content) {
        const fromText = extractText(chunk?.text);
        if (fromText) return fromText;
        const fromValue = extractText(chunk?.value);
        if (fromValue) return fromValue;
      }
    }
  }

  const topContent = responseJson.content;
  if (Array.isArray(topContent)) {
    for (const chunk of topContent) {
      const fromText = extractText(chunk?.text);
      if (fromText) return fromText;
      const fromValue = extractText(chunk?.value);
      if (fromValue) return fromValue;
    }
  }

  const scan = (node: unknown): string | null => {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (
        isUsableSentence(trimmed) &&
        !trimmed.startsWith("{") &&
        !trimmed.startsWith("[")
      ) {
        return trimmed;
      }
      return null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = scan(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof node === "object" && node != null) {
      const obj = node as Record<string, unknown>;
      const priorityKeys = ["output_text", "text", "value", "message"];
      for (const key of priorityKeys) {
        if (key in obj) {
          const found = scan(obj[key]);
          if (found) return found;
        }
      }
      for (const value of Object.values(obj)) {
        const found = scan(value);
        if (found) return found;
      }
    }
    return null;
  };

  const scanned = scan(responseJson);
  if (scanned) return scanned;

  return null;
}

function buildLocalFallbackHeadline(summary: SnapshotSummary) {
  const change = summary.daily_change_pct;
  const sentiment = summary.sentiment_label?.toLowerCase() ?? "neutral sentiment";
  const trend =
    change == null
      ? "mixed momentum"
      : change >= 1
        ? "constructive momentum"
        : change <= -1
          ? "defensive momentum"
          : "sideways momentum";

  return `Market structure shows ${trend} with ${sentiment}; consider scaling entries rather than chasing moves, and keep risk tight if volatility expands unexpectedly.`;
}

async function requestChatFallback(apiKey: string, model: string, summary: SnapshotSummary) {
  const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a crypto market analyst. Return exactly one sentence, plain text, no markdown, max 32 words, no dollar or percent figures.",
        },
        {
          role: "user",
          content: `Give one non-obvious interpretation, one cautious action, and one short caveat for this snapshot: ${JSON.stringify(
            summary
          )}.`,
        },
      ],
      max_tokens: 80,
    }),
    cache: "no-store",
  });

  if (!chatRes.ok) return null;
  const chatJson = (await chatRes.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = chatJson?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((item) => item?.text ?? "")
      .join(" ")
      .trim();
    if (joined) return joined;
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

  const payloadSummary: SnapshotSummary = {
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
  const responseId = typeof responseJson.id === "string" ? responseJson.id : null;
  let analysisSource: "responses" | "chat_fallback" | "local_fallback" = "responses";
  let headline = extractHeadline(responseJson);
  if (!headline) {
    const chatModel = process.env.OPENAI_CHAT_FALLBACK_MODEL ?? "gpt-4o-mini";
    headline = await requestChatFallback(apiKey, chatModel, payloadSummary);
    if (headline) analysisSource = "chat_fallback";
  }
  if (!headline) {
    headline = buildLocalFallbackHeadline(payloadSummary);
    analysisSource = "local_fallback";
  }

  return NextResponse.json(
    { headline, model, responseId, analysisSource, ts: Date.now() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
