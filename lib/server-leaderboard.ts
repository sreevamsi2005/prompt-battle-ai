import { blobGet, blobSet } from "./blob-storage";
import type { LeaderboardEntry } from "@/lib/types";

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  return blobGet<LeaderboardEntry[]>("leaderboard", "entries", []);
}

export async function saveLeaderboard(entries: LeaderboardEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.score - a.score).slice(0, 100);
  await blobSet("leaderboard", "entries", sorted);
}

export async function addEntry(playerName: string, score: number): Promise<LeaderboardEntry[]> {
  const entries = await loadLeaderboard();
  entries.push({ playerName: playerName.trim() || "Booth Player", score, timestamp: Date.now() });
  await saveLeaderboard(entries);
  return entries;
}
