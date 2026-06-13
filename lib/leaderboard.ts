import type { LeaderboardEntry } from "@/lib/types";

const PLAYER_NAME_KEY = "pb_player_name";

export function getPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLAYER_NAME_KEY);
}

export function setPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAYER_NAME_KEY, name.trim());
}

export function getMockLeaderboard(): LeaderboardEntry[] {
  return [
    { playerName: "NeonOracle",    similarityScore: 94, normalizedScore: 118, timeTakenToPrompt: 32, timestamp: Date.now() - 3600000 },
    { playerName: "PromptSamurai", similarityScore: 88, normalizedScore: 110, timeTakenToPrompt: 28, timestamp: Date.now() - 7200000 },
    { playerName: "CineMind",      similarityScore: 81, normalizedScore: 101, timeTakenToPrompt: 45, timestamp: Date.now() - 10800000 },
    { playerName: "VoxelDreamer",  similarityScore: 72, normalizedScore: 90,  timeTakenToPrompt: 51, timestamp: Date.now() - 14400000 },
    { playerName: "LatentWave",    similarityScore: 65, normalizedScore: 81,  timeTakenToPrompt: 55, timestamp: Date.now() - 18000000 },
  ];
}
