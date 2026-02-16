import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, AUTH_COOKIE_NAME } from "@/app/lib/auth";
import {
  addJournalEntry,
  deleteJournalEntry,
  listJournalEntries,
  type JournalEntry,
} from "@/app/lib/journal-store";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

async function getSessionUsername() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return verifySessionToken(token)?.username ?? null;
}

export async function GET() {
  const username = await getSessionUsername();
  if (!username) return unauthorized();
  const entries = await listJournalEntries(username);
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const username = await getSessionUsername();
  if (!username) return unauthorized();

  let body: Partial<JournalEntry>;
  try {
    body = (await req.json()) as Partial<JournalEntry>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const notes = (body.notes ?? "").trim();
  if (!title || !notes) {
    return NextResponse.json({ error: "Title and notes are required" }, { status: 400 });
  }

  const entry: JournalEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    date: String(body.date ?? ""),
    kind:
      body.kind === "transfer" ||
      body.kind === "liquidity" ||
      body.kind === "staking" ||
      body.kind === "swap" ||
      body.kind === "bridge" ||
      body.kind === "other"
        ? body.kind
        : "other",
    chain: String(body.chain ?? "").trim(),
    protocol: String(body.protocol ?? "").trim(),
    title,
    notes,
    amount: String(body.amount ?? "").trim(),
    token: String(body.token ?? "").trim().toUpperCase(),
    intensity:
      body.intensity === "low" || body.intensity === "medium" || body.intensity === "high"
        ? body.intensity
        : "medium",
  };

  await addJournalEntry(username, entry);
  return NextResponse.json({ entry });
}

export async function DELETE(req: Request) {
  const username = await getSessionUsername();
  if (!username) return unauthorized();

  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "Entry id is required" }, { status: 400 });
  }

  const deleted = await deleteJournalEntry(username, id);
  if (!deleted) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
