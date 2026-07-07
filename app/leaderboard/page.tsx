"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Leaderboard from "@/components/Leaderboard";
import { getPlayerName } from "@/lib/leaderboard";
import type { LeaderboardEntry } from "@/lib/types";

// Keep only entries on the current schema (numeric similarityScore). Legacy
// records that predate it are dropped rather than shown misleadingly. Rank by the
// final score (composite text+video, or text-only until video arrives).
const finalOf = (e: LeaderboardEntry) => e.compositeScore ?? e.similarityScore;
function normalizeAndSort(arr: LeaderboardEntry[]): LeaderboardEntry[] {
  return arr
    .filter((e) => typeof e.similarityScore === "number")
    .sort((a, b) =>
      finalOf(b) !== finalOf(a)
        ? finalOf(b) - finalOf(a)
        : (a.timeTakenToPrompt ?? 0) - (b.timeTakenToPrompt ?? 0)
    );
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [playerName, setPlayerName] = useState<string | null>(null);

  // Always show the global leaderboard. Poll every 5s so scores update live.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/leaderboard");
        const data = (await res.json()) as LeaderboardEntry[];
        setEntries(normalizeAndSort(data));
      } catch (err) {
        console.error("Failed to load leaderboard data:", err);
      }
    };

    load();
    setPlayerName(getPlayerName());
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] py-10">
      <div className="mx-auto max-w-3xl px-4">

        {/* Header section */}
        <div className="mb-8 border-b border-zinc-900 pb-6">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 font-mono">
            Booth Scoreboards
          </p>
          <h1 className="text-xl font-bold tracking-tight text-white mt-1">
            Leaderboard
          </h1>
        </div>

        {/* Leaderboard Table / Podium */}
        <Leaderboard entries={entries} highlightPlayer={playerName ?? undefined} />

        <div className="mt-10 flex justify-center">
          <Link href="/play" className="btn-primary">
            Start Challenge
          </Link>
        </div>
      </div>
    </div>
  );
}
