"use client";

import { motion } from "framer-motion";
import type { LeaderboardEntry } from "@/lib/types";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  highlightPlayer?: string;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MEDAL_STYLES = [
  { rank: 1, color: "text-amber-400 bg-amber-500/5 border-amber-500/30", icon: "🥇" },
  { rank: 2, color: "text-zinc-200 bg-zinc-355/5 border-zinc-300/30", icon: "🥈" },
  { rank: 3, color: "text-orange-400 bg-orange-500/5 border-orange-500/30", icon: "🥉" }
];

export default function Leaderboard({ entries, highlightPlayer }: LeaderboardProps) {
  const topThree = entries.slice(0, 3);
  const rest = entries.slice(3);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-[#040405]/70 py-16 text-center text-sm text-zinc-500 font-mono">
        No scores recorded under this category yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top 3 Podium Cards */}
      {topThree.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {topThree.map((entry, idx) => {
            const isHighlight =
              highlightPlayer &&
              entry.playerName.toLowerCase() === highlightPlayer.toLowerCase();
            const medal = MEDAL_STYLES[idx] || { rank: idx + 1, color: "text-zinc-400 bg-zinc-900 border-zinc-850", icon: "•" };

            return (
              <motion.div
                key={entry.playerName + entry.timestamp + idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className={`graphite-card p-5 relative flex flex-col justify-between ${
                  isHighlight ? "border-[#0066FF] bg-[#0066FF]/10 shadow-[0_0_30px_rgba(0,102,255,0.15)]" : ""
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-mono font-bold border ${medal.color}`}>
                    RANK #{medal.rank}
                  </span>
                  <span className="text-lg">{medal.icon}</span>
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white truncate">
                    {entry.playerName}
                  </h3>
                  <div className="flex items-baseline gap-1 mt-1.5">
                    <span className="text-3xl font-extrabold tracking-tight text-[#0066FF] font-mono">
                      {entry.score}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono font-semibold">pts</span>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono mt-2 border-t border-zinc-900 pt-2">
                    {formatTime(entry.timestamp)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Ranks 4+ Table */}
      {rest.length > 0 && (
        <div className="graphite-card divide-y divide-zinc-900 overflow-hidden">
          {rest.map((entry, i) => {
            const rank = i + 4;
            const isHighlight =
              highlightPlayer &&
              entry.playerName.toLowerCase() === highlightPlayer.toLowerCase();

            return (
              <motion.div
                key={entry.playerName + entry.timestamp + rank}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 * i }}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${
                  isHighlight ? "bg-[#0066FF]/10" : ""
                }`}
              >
                <div className="flex items-center gap-4.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-[#040405] text-xs font-mono font-bold text-zinc-400">
                    {rank}
                  </span>
                  <div>
                    <p className="text-xs sm:text-sm font-bold text-white">{entry.playerName}</p>
                    <p className="text-[10px] text-zinc-500 font-mono mt-1">
                      {formatTime(entry.timestamp)}
                    </p>
                  </div>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base font-extrabold text-zinc-200 font-mono">{entry.score}</span>
                  <span className="text-xs text-zinc-500 font-mono font-semibold">pts</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
