import { blobGet, blobSet, blobUpdate } from "./blob-storage";
import type { LeaderboardEntry } from "@/lib/types";

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  return blobGet<LeaderboardEntry[]>("leaderboard", "entries", []);
}

function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.normalizedScore !== a.normalizedScore) return b.normalizedScore - a.normalizedScore;
    return a.timeTakenToPrompt - b.timeTakenToPrompt;
  });
}

export async function saveLeaderboard(entries: LeaderboardEntry[]): Promise<void> {
  await blobSet("leaderboard", "entries", sortLeaderboard(entries).slice(0, 100));
}

export async function clearLeaderboard(): Promise<void> {
  await blobSet("leaderboard", "entries", []);
}

export async function addEntry(
  playerName: string,
  similarityScore: number,
  normalizedScore: number,
  timeTakenToPrompt: number,
  email?: string,
  compositeScore?: number,
  videoScore?: number
): Promise<LeaderboardEntry[]> {
  return blobUpdate<LeaderboardEntry[]>("leaderboard", "entries", [], (cur) =>
    sortLeaderboard([
      ...cur,
      {
        playerName: playerName.trim() || "Booth Player",
        similarityScore,
        normalizedScore,
        timeTakenToPrompt,
        timestamp: Date.now(),
        ...(email ? { email } : {}),
        ...(compositeScore != null ? { compositeScore } : {}),
        ...(videoScore != null ? { videoScore } : {}),
      },
    ]).slice(0, 100)
  );
}
