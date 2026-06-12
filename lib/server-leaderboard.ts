import { blobGet, blobSet, blobUpdate } from "./blob-storage";
import type { LeaderboardEntry } from "@/lib/types";

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  return blobGet<LeaderboardEntry[]>("leaderboard", "entries", []);
}

export async function saveLeaderboard(entries: LeaderboardEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.score - a.score).slice(0, 100);
  await blobSet("leaderboard", "entries", sorted);
}

export async function addEntry(playerName: string, score: number): Promise<LeaderboardEntry[]> {
  // Atomic update — concurrent submitters can't drop each other's entries.
  return blobUpdate<LeaderboardEntry[]>("leaderboard", "entries", [], (cur) =>
    [...cur, { playerName: playerName.trim() || "Booth Player", score, timestamp: Date.now() }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
  );
}
