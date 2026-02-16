import { promises as fs } from "fs";
import path from "path";

export type JournalEntry = {
  id: string;
  createdAt: string;
  date: string;
  kind: "transfer" | "liquidity" | "staking" | "swap" | "bridge" | "other";
  chain: string;
  protocol: string;
  title: string;
  notes: string;
  amount: string;
  token: string;
  intensity: "low" | "medium" | "high";
};

type JournalDb = {
  users: Record<string, JournalEntry[]>;
};

const DB_PATH = path.join(process.cwd(), "data", "journal.json");

async function ensureDb() {
  const dir = path.dirname(DB_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    const initial: JournalDb = { users: {} };
    await fs.writeFile(DB_PATH, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function readDb(): Promise<JournalDb> {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as JournalDb;
    if (!parsed || typeof parsed !== "object" || typeof parsed.users !== "object") {
      return { users: {} };
    }
    return parsed;
  } catch {
    return { users: {} };
  }
}

async function writeDb(db: JournalDb) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

export async function listJournalEntries(username: string) {
  const db = await readDb();
  const entries = db.users[username] ?? [];
  return [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function addJournalEntry(username: string, entry: JournalEntry) {
  const db = await readDb();
  const userEntries = db.users[username] ?? [];
  db.users[username] = [entry, ...userEntries];
  await writeDb(db);
  return entry;
}

export async function deleteJournalEntry(username: string, id: string) {
  const db = await readDb();
  const userEntries = db.users[username] ?? [];
  const next = userEntries.filter((entry) => entry.id !== id);
  const deleted = next.length !== userEntries.length;
  db.users[username] = next;
  await writeDb(db);
  return deleted;
}
