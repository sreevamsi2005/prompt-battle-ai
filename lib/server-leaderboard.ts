import fs from "fs";
import path from "path";
import type { LeaderboardEntry } from "@/lib/types";

const LEADERBOARD_FILE = path.join(process.cwd(), "data", "leaderboard.json");

function ensureDir() {
  const dir = path.dirname(LEADERBOARD_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadLeaderboard(): LeaderboardEntry[] {
  try {
    ensureDir();
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const raw = fs.readFileSync(LEADERBOARD_FILE, "utf-8");
      return JSON.parse(raw) as LeaderboardEntry[];
    }
  } catch (err) {
    console.error("Error loading leaderboard:", err);
  }
  return [];
}

export function saveLeaderboard(entries: LeaderboardEntry[]) {
  try {
    ensureDir();
    const sorted = [...entries]
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(sorted, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving leaderboard:", err);
  }
}

export function addEntry(playerName: string, score: number): LeaderboardEntry[] {
  const entries = loadLeaderboard();
  entries.push({
    playerName: playerName.trim() || "Booth Player",
    score,
    timestamp: Date.now(),
  });
  saveLeaderboard(entries);
  return entries;
}
