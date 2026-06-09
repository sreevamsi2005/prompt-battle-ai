"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Leaderboard from "@/components/Leaderboard";
import { getMockLeaderboard, getPlayerName } from "@/lib/leaderboard";
import type { LeaderboardEntry } from "@/lib/types";

interface RoomListItem {
  id: string;
  name: string;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [playerName, setPlayerName] = useState<string | null>(null);
  
  // Filtering states
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [filterRoomId, setFilterRoomId] = useState<string>("global");

  // Load rooms filter dropdown
  useEffect(() => {
    fetch("/api/rooms")
      .then(res => res.json())
      .then(data => setRooms(data))
      .catch(err => console.error("Failed to load rooms list:", err));
  }, []);

  // Fetch leaderboard based on active filter
  useEffect(() => {
    const load = async () => {
      try {
        const url = filterRoomId === "global" 
          ? "/api/leaderboard" 
          : `/api/leaderboard?roomId=${filterRoomId}`;
        
        const res = await fetch(url);
        const data = (await res.json()) as LeaderboardEntry[];

        // Only merge with mock entries when viewing the global leaderboard
        if (filterRoomId === "global") {
          const mock = getMockLeaderboard();
          const merged = [...data];
          for (const m of mock) {
            if (!merged.some(e => e.playerName === m.playerName && e.score === m.score)) {
              merged.push(m);
            }
          }
          merged.sort((a, b) => b.score - a.score);
          setEntries(merged);
        } else {
          setEntries(data.sort((a, b) => b.score - a.score));
        }
      } catch (err) {
        console.error("Failed to load leaderboard data:", err);
        setEntries(filterRoomId === "global" ? getMockLeaderboard() : []);
      }
    };

    load();
    setPlayerName(getPlayerName());
  }, [filterRoomId]);

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] py-10">
      <div className="mx-auto max-w-3xl px-4">
        
        {/* Header section */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-900 pb-6">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 font-mono">
              Booth Scoreboards
            </p>
            <h1 className="text-xl font-bold tracking-tight text-white mt-1">
              Leaderboard
            </h1>
          </div>

          {/* Room Filter Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-zinc-500 font-mono uppercase">Filter:</span>
            <select
              value={filterRoomId}
              onChange={(e) => setFilterRoomId(e.target.value)}
              className="rounded border border-zinc-800 bg-[#09090b] text-xs text-white px-3 py-1.5 focus:border-[#0066FF] focus:outline-none"
            >
              <option value="global">Global Standings (All-Time)</option>
              <optgroup label="Multiplayer Booth Rooms">
                {rooms.map(room => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
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
