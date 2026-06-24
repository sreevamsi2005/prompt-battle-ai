import { blobGet, blobSet, blobUpdate } from "./blob-storage";
import type { LeaderboardEntry } from "@/lib/types";

export async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  return blobGet<LeaderboardEntry[]>("leaderboard", "entries", []);
}

// Rank by final score (composite text+video; text-only until video arrives).
const finalOf = (e: LeaderboardEntry) => e.compositeScore ?? e.similarityScore;
function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (finalOf(b) !== finalOf(a)) return finalOf(b) - finalOf(a);
    return a.timeTakenToPrompt - b.timeTakenToPrompt;
  });
}

export async function saveLeaderboard(entries: LeaderboardEntry[]): Promise<void> {
  await blobSet("leaderboard", "entries", sortLeaderboard(entries).slice(0, 100));
}

export async function clearLeaderboard(): Promise<void> {
  await blobSet("leaderboard", "entries", []);
}

// Upsert by player name: one entry per player (their latest result). This lets us
// post a text-only score the moment they submit, then update it in place once the
// video similarity is computed — without creating duplicate rows.
export async function addEntry(
  playerName: string,
  similarityScore: number,
  timeTakenToPrompt: number,
  email?: string,
  compositeScore?: number,
  videoScore?: number
): Promise<LeaderboardEntry[]> {
  const name = playerName.trim() || "Booth Player";
  return blobUpdate<LeaderboardEntry[]>("leaderboard", "entries", [], (cur) => {
    const rest = cur.filter(e => e.playerName.toLowerCase() !== name.toLowerCase());
    return sortLeaderboard([
      ...rest,
      {
        playerName: name,
        similarityScore,
        timeTakenToPrompt,
        timestamp: Date.now(),
        ...(email ? { email } : {}),
        ...(compositeScore != null ? { compositeScore } : {}),
        ...(videoScore != null ? { videoScore } : {}),
      },
    ]).slice(0, 100);
  });
}
