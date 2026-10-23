import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Debate } from "./types.js";

const DB_FILE = resolve(process.env.DEBATE_STORE_FILE ?? "./data/debates.json");

export async function saveDebate(debate: Debate): Promise<void> {
  await mkdir(dirname(DB_FILE), { recursive: true });
  const all = await listDebates();
  const index = all.findIndex((d) => d.id === debate.id);
  if (index >= 0) all[index] = debate; else all.push(debate);
  await writeFile(DB_FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function listDebates(): Promise<Debate[]> {
  try {
    return JSON.parse(await readFile(DB_FILE, "utf8")) as Debate[];
  } catch {
    return [];
  }
}
