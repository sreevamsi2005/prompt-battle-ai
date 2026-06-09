"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

interface RoomAdminState {
  id: string;
  name: string;
  maxUsers: number;
  activeChallengeId: string | null;
  players: { playerName: string; lastSeen: number }[];
  submissionCount: number;
  submissions: { playerName: string; score: number; timestamp: number }[];
}

interface PromptListItem {
  id: string;
  theme: string;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  
  // Rooms & Prompts lists
  const [adminRooms, setAdminRooms] = useState<RoomAdminState[]>([]);
  const [promptsList, setPromptsList] = useState<PromptListItem[]>([]);
  
  // Room Creation state
  const [roomName, setRoomName] = useState("");
  const [roomMaxUsers, setRoomMaxUsers] = useState(4);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef(password);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  // Load available challenge options for selector dropdown
  const loadChallengeChoices = async () => {
    try {
      const res = await fetch("/api/admin/prompts", {
        headers: { "x-admin-password": passwordRef.current },
      });
      if (res.ok) {
        const data = await res.json();
        setPromptsList(data.map((p: any) => ({ id: p.id, theme: p.theme })));
      }
    } catch (err) {
      console.error("Failed to load prompt challenge list:", err);
    }
  };

  // Load rooms with stats
  const loadRoomsData = async () => {
    if (!authenticated) return;
    try {
      const res = await fetch("/api/admin/rooms", {
        headers: { "x-admin-password": passwordRef.current },
      });
      if (res.ok) {
        const data = await res.json();
        setAdminRooms(data);
      }
    } catch (err) {
      console.error("Failed to load admin rooms:", err);
    }
  };

  // Poll room updates if authenticated
  useEffect(() => {
    if (!authenticated) return;
    loadChallengeChoices();
    loadRoomsData();

    const t = setInterval(loadRoomsData, 3000);
    return () => clearInterval(t);
  }, [authenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // Test credentials with prompts endpoint
      const res = await fetch("/api/admin/prompts", {
        headers: { "x-admin-password": password },
      });
      if (res.ok) {
        setAuthenticated(true);
      } else {
        setError("Invalid admin passcode");
      }
    } catch (e) {
      setError("Server connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    setPassword("");
    setAdminRooms([]);
    setPromptsList([]);
  };

  // Create active Battle Room
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/admin/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ name: roomName.trim(), maxUsers: roomMaxUsers }),
      });

      if (res.ok) {
        const data = await res.json();
        setAdminRooms(data);
        setRoomName("");
      } else {
        alert("Failed to initialize room");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Sync challenge challengeId
  const handleUpdateRoomChallenge = async (roomId: string, challengeId: string | null) => {
    try {
      const res = await fetch(`/api/admin/rooms?id=${roomId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ challengeId }),
      });

      if (res.ok) {
        loadRoomsData();
      } else {
        alert("Failed to sync room video challenge");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!confirm("Terminate this battle room? All synced connections will exit.")) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/rooms?id=${id}`, {
        method: "DELETE",
        headers: { "x-admin-password": password },
      });

      if (res.ok) {
        const data = await res.json();
        setAdminRooms(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // RENDERING LOGIN SCREEN
  if (!authenticated) {
    return (
      <div className="relative min-h-[calc(100vh-3.5rem)] flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="w-full max-w-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="graphite-card p-6"
          >
            <h1 className="text-base font-bold text-white tracking-tight">Admin Passcode</h1>
            <p className="mt-1.5 text-xs sm:text-sm text-zinc-400">
              Access the session manager dashboard for booth laptops.
            </p>

            <form onSubmit={handleLogin} className="space-y-4 mt-5">
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">
                  Passcode
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin passcode"
                  className="input-field text-sm"
                />
              </div>
              
              {error && <p className="text-xs sm:text-sm text-rose-400 font-mono font-semibold">{error}</p>}
              
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5 text-sm font-bold uppercase tracking-wider"
              >
                Sign In
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-zinc-900 flex justify-center">
              <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
                ← Back to Homepage
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // RENDERING ROOM ADMIN PANEL
  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] py-8">
      <div className="mx-auto max-w-6xl px-4">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-5 mb-6">
          <div>
            <p className="text-xs uppercase font-bold text-zinc-500 font-mono tracking-wider">
              Control Panel
            </p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white mt-1">
              Multiplayer Room Creator
            </h1>
          </div>
          <button onClick={handleLogout} className="btn-secondary py-1.5 px-4 text-sm font-semibold">
            Sign Out
          </button>
        </div>

        {/* Dashboard layout */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          
          {/* Create Room Form */}
          <div className="graphite-card p-5 h-fit">
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono mb-4 border-b border-zinc-900 pb-2">
              Launch Battle Room
            </h2>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-500 font-mono mb-1.5">Room Title</label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Session Alpha"
                  className="input-field text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-500 font-mono mb-1.5">Max Connected Laptops</label>
                <input
                  type="number"
                  value={roomMaxUsers}
                  onChange={(e) => setRoomMaxUsers(Number(e.target.value))}
                  min={1}
                  max={6}
                  className="input-field font-mono text-sm"
                />
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full text-xs sm:text-sm font-bold uppercase tracking-wider mt-2">
                Launch Room Session
              </button>
            </form>
          </div>

          {/* Rooms Monitor List */}
          <div className="graphite-card p-5">
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono mb-4 border-b border-zinc-900 pb-2">
              Active Battle Session Monitors
            </h2>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {adminRooms.map((room) => (
                <div
                  key={room.id}
                  className="p-4 rounded border border-zinc-800 bg-black/40 space-y-4"
                >
                  {/* Room title header */}
                  <div className="flex items-center justify-between border-b border-zinc-950 pb-2 flex-wrap gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                        {room.name}
                        <span className="text-xs font-normal text-zinc-500">
                          ({room.id})
                        </span>
                      </h3>
                      <p className="text-xs text-zinc-400 font-mono mt-0.5">
                        Capacity: {room.players?.length || 0} / {room.maxUsers} connected laptops
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Selector of prompt */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 font-mono">Sync Video:</span>
                        <select
                          value={room.activeChallengeId || ""}
                          onChange={(e) => handleUpdateRoomChallenge(room.id, e.target.value || null)}
                          className="rounded border border-zinc-800 bg-zinc-950 text-xs text-white px-2.5 py-1.5 focus:outline-none focus:border-[#0066FF]"
                        >
                          <option value="">-- No Challenge Synced --</option>
                          {promptsList.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.id} ({p.theme})
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        onClick={() => handleDeleteRoom(room.id)}
                        className="text-xs text-rose-500 hover:text-rose-400 font-bold border-l border-zinc-900 pl-3 ml-1"
                      >
                        Terminate
                      </button>
                    </div>
                  </div>

                  {/* Room dashboard details (users and submissions) */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Joined users status */}
                    <div className="bg-[#050507] p-3 rounded border border-zinc-950">
                      <p className="text-xs uppercase font-bold tracking-wider text-zinc-500 font-mono border-b border-zinc-900 pb-1.5 mb-2">
                        Connected Laptops ({room.players?.length || 0})
                      </p>
                      
                      <div className="space-y-1.5">
                        {room.players && room.players.length > 0 ? (
                          room.players.map(p => {
                            const hasSub = room.submissions?.some(s => s.playerName.toLowerCase() === p.playerName.toLowerCase());
                            return (
                              <div key={p.playerName} className="flex items-center justify-between text-xs font-mono">
                                <span className="text-zinc-300 truncate max-w-[140px] font-semibold">{p.playerName}</span>
                                {hasSub ? (
                                  <span className="text-emerald-400 text-[10px] bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                                    Submitted ✓
                                  </span>
                                ) : (
                                  <span className="text-amber-400 text-[10px] bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 animate-pulse">
                                    Writing...
                                  </span>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-zinc-600 font-mono py-1">No laptops connected yet</p>
                        )}
                      </div>
                    </div>

                    {/* Scores submissions */}
                    <div className="bg-[#050507] p-3 rounded border border-zinc-950">
                      <p className="text-xs uppercase font-bold tracking-wider text-[#0066FF] font-mono border-b border-zinc-900 pb-1.5 mb-2 flex items-center justify-between">
                        <span>Room Rankings</span>
                        <span className="text-[10px] font-normal text-zinc-500 font-mono">Submits: {room.submissionCount}</span>
                      </p>
                      
                      <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-0.5">
                        {room.submissions && room.submissions.length > 0 ? (
                          room.submissions.map((sub, idx) => (
                            <div key={sub.playerName + idx} className="flex items-center justify-between text-xs font-mono">
                              <span className="text-zinc-400 truncate max-w-[140px]">
                                #{idx + 1} {sub.playerName}
                              </span>
                              <span className="text-white font-bold">{sub.score}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-600 font-mono py-1">Awaiting player submits...</p>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              ))}
              {adminRooms.length === 0 && (
                <p className="text-center py-12 text-xs sm:text-sm text-zinc-600 font-mono border border-dashed border-zinc-800 rounded">
                  No active multiplayer sessions created.<br />Launch a battle room to start syncing laptops.
                </p>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
