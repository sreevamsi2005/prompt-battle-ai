"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAdminAuth } from "@/contexts/admin-auth";

interface ChallengeDetails {
  id: string;
  theme: string;
  difficulty: "easy" | "medium" | "hard";
  videoUrl: string;
}

interface RoomAdminState {
  id: string;
  name: string;
  maxUsers: number;
  activeChallengeId: string | null;
  challengeDetails: ChallengeDetails | null;
  players: { playerName: string; lastSeen: number }[];
  submissionCount: number;
  submissions: { playerName: string; score: number; points: number; timestamp: number }[];
  replayRequests: { roomId: string; playerName: string; timestamp: number }[];
}

interface PromptListItem {
  id: string;
  theme: string;
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
}

const DIFFICULTY_STYLE: Record<string, string> = {
  easy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  hard: "text-rose-400 bg-rose-500/10 border-rose-500/30",
};

const MEDAL = ["🥇", "🥈", "🥉"];
const RANK_STYLE = [
  "border-yellow-500/40 bg-yellow-500/8 text-yellow-300",
  "border-zinc-400/30 bg-zinc-400/8 text-zinc-200",
  "border-amber-700/40 bg-amber-700/8 text-amber-400",
];

function LiveVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.load();
    const play = () => el.play().catch(() => {});
    if (el.readyState >= 3) play();
    else el.addEventListener("canplay", play, { once: true });
    return () => el.removeEventListener("canplay", play);
  }, [src]);
  return (
    <video ref={ref} src={src} muted playsInline loop preload="auto" className="w-full h-full object-cover" />
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const { setIsAdmin } = useAdminAuth();

  const [adminRooms, setAdminRooms] = useState<RoomAdminState[]>([]);
  const [promptsList, setPromptsList] = useState<PromptListItem[]>([]);

  const [roomName, setRoomName] = useState("");
  const [roomMaxUsers, setRoomMaxUsers] = useState(4);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [heroRoomId, setHeroRoomId] = useState<string | null>(null);

  const passwordRef = useRef(password);
  useEffect(() => { passwordRef.current = password; }, [password]);

  useEffect(() => {
    const active = adminRooms.filter(r => r.activeChallengeId && r.challengeDetails?.videoUrl);
    if (active.length === 0) { setHeroRoomId(null); return; }
    setHeroRoomId(prev => {
      const stillValid = prev && active.some(r => r.id === prev);
      return stillValid ? prev : active[0].id;
    });
  }, [adminRooms]);

  const loadChallengeChoices = async () => {
    try {
      const res = await fetch("/api/admin/prompts", { headers: { "x-admin-password": passwordRef.current } });
      if (res.ok) {
        const data = await res.json();
        setPromptsList(data.map((p: any) => ({ id: p.id, theme: p.theme, difficulty: p.difficulty, prompt: p.prompt })));
      }
    } catch (err) { console.error("Failed to load prompt challenge list:", err); }
  };

  const loadRoomsData = async () => {
    if (!authenticated) return;
    try {
      const res = await fetch("/api/admin/rooms", { headers: { "x-admin-password": passwordRef.current } });
      if (res.ok) setAdminRooms(await res.json());
    } catch (err) { console.error("Failed to load admin rooms:", err); }
  };

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
      const res = await fetch("/api/admin/prompts", { headers: { "x-admin-password": password } });
      if (res.ok) { setAuthenticated(true); setIsAdmin(true); }
      else { setError("Invalid admin passcode"); }
    } catch { setError("Server connection failed"); }
    finally { setLoading(false); }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    setIsAdmin(false);
    setPassword("");
    setAdminRooms([]);
    setPromptsList([]);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ name: roomName.trim(), maxUsers: roomMaxUsers }),
      });
      if (res.ok) { setAdminRooms(await res.json()); setRoomName(""); }
      else { alert("Failed to initialize room"); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleUpdateRoomChallenge = async (roomId: string, challengeId: string | null) => {
    try {
      const res = await fetch(`/api/admin/rooms?id=${roomId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ challengeId }),
      });
      if (res.ok) { loadRoomsData(); }
      else { alert("Failed to sync room video challenge"); }
    } catch (e) { console.error(e); }
  };

  const handleRoomAction = async (roomId: string, action: string) => {
    if (action === "reset-scores" && !confirm("Clear all scores for this room?")) return;
    try {
      const res = await fetch(`/api/admin/rooms?id=${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ action }),
      });
      if (res.ok) { setAdminRooms(await res.json()); }
      else { alert("Action failed"); }
    } catch (e) { console.error(e); }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!confirm("Terminate this battle room? All synced connections will exit.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/rooms?id=${id}`, {
        method: "DELETE",
        headers: { "x-admin-password": password },
      });
      if (res.ok) { setAdminRooms(await res.json()); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // ── LOGIN ───────────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="relative min-h-[calc(100vh-3.5rem)] flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="w-full max-w-sm">
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="graphite-card p-6">
            <h1 className="text-base font-bold text-white tracking-tight">Admin Passcode</h1>
            <p className="mt-1.5 text-xs sm:text-sm text-zinc-400">Access the session manager dashboard for booth laptops.</p>
            <form onSubmit={handleLogin} className="space-y-4 mt-5">
              <div>
                <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">Passcode</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter admin passcode" className="input-field text-sm" />
              </div>
              {error && <p className="text-xs sm:text-sm text-rose-400 font-mono font-semibold">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-sm font-bold uppercase tracking-wider">Sign In</button>
            </form>
            <div className="mt-5 pt-4 border-t border-zinc-900 flex justify-center">
              <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">← Back to Homepage</Link>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // Derived: rooms with a live challenge video.
  const heroRooms = adminRooms.filter(r => r.activeChallengeId && r.challengeDetails?.videoUrl);
  const heroRoom = heroRooms.find(r => r.id === heroRoomId) ?? heroRooms[0] ?? null;

  function buildRoundRankings(room: RoomAdminState) {
    const submitted = room.submissions ?? [];
    const submittedNames = new Set(submitted.map(s => s.playerName.toLowerCase()));
    const pending = (room.players ?? [])
      .filter(p => !submittedNames.has(p.playerName.toLowerCase()))
      .map(p => ({ playerName: p.playerName, score: null as number | null, points: null as number | null }));
    return [
      ...submitted.map(s => ({ playerName: s.playerName, score: s.score, points: s.points })),
      ...pending,
    ];
  }

  // ── AUTHENTICATED PANEL ─────────────────────────────────────────────────────
  return (
    <div className="relative">

      {/* ── HERO: fills viewport below navbar ────────────────────────────── */}
      <section className="h-[calc(100vh-3.5rem)] px-4 py-3 overflow-hidden flex flex-col">
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col gap-3 min-h-0">

          {/* Room selector tabs — only when multiple rooms have active challenges */}
          {heroRooms.length > 1 && (
            <div className="flex-shrink-0 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider mr-1">Viewing:</span>
              {heroRooms.map(r => (
                <button
                  key={r.id}
                  onClick={() => setHeroRoomId(r.id)}
                  className={`text-xs font-bold font-mono px-3 py-1 rounded border transition ${
                    r.id === heroRoom?.id
                      ? "bg-[#0066FF]/20 border-[#0066FF]/50 text-[#0066FF]"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}

          {/* Main hero content */}
          {heroRoom ? (
            <div className="flex-1 grid gap-3 lg:grid-cols-[7fr_3fr] min-h-0">

              {/* LEFT: Video — fills cell height */}
              <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-black min-h-0">
                <LiveVideo src={heroRoom.challengeDetails!.videoUrl} />

                {/* Overlay: room name + theme */}
                <div className="absolute top-0 left-0 right-0 p-4 flex items-start justify-between bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                  <div>
                    <p className="text-xs uppercase font-bold text-zinc-400 font-mono tracking-wider">{heroRoom.name}</p>
                    <p className="text-sm font-bold text-white mt-0.5 font-mono">{heroRoom.challengeDetails!.theme}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase font-mono border ${DIFFICULTY_STYLE[heroRoom.challengeDetails!.difficulty]}`}>
                    {heroRoom.challengeDetails!.difficulty}
                  </span>
                </div>

                {/* LIVE badge */}
                <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded border border-zinc-700 bg-black/90 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur pointer-events-none">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0066FF] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0066FF]" />
                  </span>
                  LIVE CHALLENGE
                </div>
              </div>

              {/* RIGHT: Round standings — fills cell height */}
              <div className="graphite-card p-4 flex flex-col gap-3 min-h-0 overflow-hidden">

                <div className="flex-shrink-0 flex items-center justify-between border-b border-zinc-900 pb-2.5">
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-mono">Live Results</p>
                    <h2 className="text-sm font-bold text-white mt-0.5">Round Standings</h2>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {heroRoom.submissionCount}/{heroRoom.players?.length || 0} submitted
                  </span>
                </div>

                {/* Rankings list — scrolls internally */}
                <div className="flex-1 space-y-1.5 overflow-y-auto min-h-0 pr-0.5">
                  {buildRoundRankings(heroRoom).length > 0 ? (
                    buildRoundRankings(heroRoom).map((entry, idx) => {
                      const submitted = entry.points !== null;
                      const rankStyle = idx < 3 && submitted ? RANK_STYLE[idx] : "border-zinc-800/60 bg-black/30 text-zinc-400";
                      return (
                        <div key={entry.playerName + idx} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${rankStyle}`}>
                          <span className="flex-shrink-0 text-base leading-none w-6 text-center">
                            {submitted && idx < 3 ? MEDAL[idx] : (
                              <span className="text-[11px] font-mono font-bold text-zinc-600">#{idx + 1}</span>
                            )}
                          </span>
                          <span className={`flex-1 font-mono font-bold truncate text-sm ${idx === 0 && submitted ? "text-yellow-200" : ""}`}>
                            {entry.playerName}
                          </span>
                          {submitted ? (
                            <div className="flex-shrink-0 text-right">
                              <p className={`text-sm font-bold font-mono leading-none ${idx === 0 ? "text-yellow-300" : ""}`}>{entry.points} pts</p>
                              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{entry.score}% match</p>
                            </div>
                          ) : (
                            <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 font-mono animate-pulse flex-shrink-0">
                              Writing…
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                      <p className="text-xs text-zinc-600 font-mono">No players connected yet.</p>
                    </div>
                  )}
                </div>

                {/* Replay requests */}
                {heroRoom.replayRequests && heroRoom.replayRequests.length > 0 && (
                  <div className="flex-shrink-0 flex items-start justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-[11px] text-amber-300 font-mono leading-relaxed">
                      <span className="font-bold">🔔 {heroRoom.replayRequests.length} next-challenge request{heroRoom.replayRequests.length > 1 ? "s" : ""}:</span>{" "}
                      {heroRoom.replayRequests.map(r => r.playerName).join(", ")}
                    </p>
                    <button
                      onClick={() => handleRoomAction(heroRoom.id, "clear-requests")}
                      className="flex-shrink-0 text-[10px] uppercase font-bold font-mono text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-1.5 py-1"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Quick actions */}
                <div className="flex-shrink-0 flex gap-2 pt-1 border-t border-zinc-900">
                  <button
                    onClick={() => handleRoomAction(heroRoom.id, "assign-random")}
                    className="flex-1 text-[10px] uppercase font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-[#0066FF]/50 hover:text-white rounded px-2 py-1.5 transition"
                  >
                    🎲 Random
                  </button>
                  <button
                    onClick={() => handleRoomAction(heroRoom.id, "reset-scores")}
                    className="flex-1 text-[10px] uppercase font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-300 rounded px-2 py-1.5 transition"
                  >
                    Reset Scores
                  </button>
                </div>
              </div>
            </div>

          ) : (
            /* No active challenge — placeholder fills hero */
            <div className="flex-1 rounded-xl border border-dashed border-zinc-800 bg-black/30 flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-full border border-zinc-700 flex items-center justify-center mb-3">
                <svg className="h-5 w-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
              </div>
              <p className="text-sm font-bold text-zinc-500 font-mono uppercase tracking-wider">No Active Challenge</p>
              <p className="text-xs text-zinc-600 font-mono mt-1.5 max-w-xs">
                Create a room and set a challenge video below — it will appear here live.
              </p>
              <p className="text-[10px] text-zinc-700 font-mono mt-1">↓ Scroll down to manage rooms</p>
            </div>
          )}

        </div>
      </section>

      {/* ── BELOW FOLD: Room Management + Library ────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">

        {/* Room Management Grid */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">

          {/* Create Room Form */}
          <div className="graphite-card p-5 h-fit">
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono mb-4 border-b border-zinc-900 pb-2">
              Launch Battle Room
            </h2>
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-500 font-mono mb-1.5">Room Title</label>
                <input type="text" value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="e.g. Session Alpha" className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-500 font-mono mb-1.5">Max Connected Laptops</label>
                <input type="number" value={roomMaxUsers} onChange={e => setRoomMaxUsers(Number(e.target.value))} min={1} max={6} className="input-field font-mono text-sm" />
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
              {adminRooms.map(room => (
                <div key={room.id} className="p-4 rounded border border-zinc-800 bg-black/40 space-y-4">

                  <div className="flex items-center justify-between border-b border-zinc-950 pb-2 flex-wrap gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                        {room.name}
                        {room.id === heroRoomId && (
                          <span className="text-[9px] font-bold bg-[#0066FF]/20 text-[#0066FF] border border-[#0066FF]/30 rounded px-1.5 py-0.5 uppercase font-mono">Live ↑</span>
                        )}
                        <span className="text-xs font-normal text-zinc-500">({room.id})</span>
                      </h3>
                      <p className="text-xs text-zinc-400 font-mono mt-0.5">
                        Capacity: {room.players?.length || 0} / {room.maxUsers}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 font-mono">Sync Video:</span>
                        <select
                          value={room.activeChallengeId || ""}
                          onChange={e => handleUpdateRoomChallenge(room.id, e.target.value || null)}
                          className="rounded border border-zinc-800 bg-zinc-950 text-xs text-white px-2.5 py-1.5 focus:outline-none focus:border-[#0066FF]"
                        >
                          <option value="">-- No Challenge Synced --</option>
                          {promptsList.map(p => (
                            <option key={p.id} value={p.id}>{p.id} ({p.theme})</option>
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

                  {room.replayRequests && room.replayRequests.length > 0 && (
                    <div className="flex items-start justify-between gap-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <p className="text-xs text-amber-300 font-mono leading-relaxed">
                        <span className="font-bold">🔔 {room.replayRequests.length} next-challenge request{room.replayRequests.length > 1 ? "s" : ""}:</span>{" "}
                        {room.replayRequests.map(r => r.playerName).join(", ")}
                      </p>
                      <button
                        onClick={() => handleRoomAction(room.id, "clear-requests")}
                        className="flex-shrink-0 text-[10px] uppercase font-bold font-mono text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-2 py-1"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleRoomAction(room.id, "assign-random")}
                      className="text-[10px] uppercase font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-[#0066FF]/50 hover:text-white rounded px-2.5 py-1.5 transition"
                    >
                      🎲 Random Challenge
                    </button>
                    <button
                      onClick={() => handleRoomAction(room.id, "reset-scores")}
                      className="text-[10px] uppercase font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-300 rounded px-2.5 py-1.5 transition"
                    >
                      Reset Scores
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
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
                                  <span className="text-emerald-400 text-[10px] bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">Submitted ✓</span>
                                ) : (
                                  <span className="text-amber-400 text-[10px] bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 animate-pulse">Writing...</span>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-zinc-600 font-mono py-1">No laptops connected yet</p>
                        )}
                      </div>
                    </div>

                    <div className="bg-[#050507] p-3 rounded border border-zinc-950">
                      <p className="text-xs uppercase font-bold tracking-wider text-[#0066FF] font-mono border-b border-zinc-900 pb-1.5 mb-2 flex items-center justify-between">
                        <span>Round Scores</span>
                        <span className="text-[10px] font-normal text-zinc-500">Submits: {room.submissionCount}</span>
                      </p>
                      <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-0.5">
                        {room.submissions && room.submissions.length > 0 ? (
                          room.submissions.map((sub, idx) => (
                            <div key={sub.playerName + idx} className="flex items-center justify-between text-xs font-mono">
                              <span className="text-zinc-400 truncate max-w-[120px]">
                                {idx < 3 ? MEDAL[idx] : `#${idx + 1}`} {sub.playerName}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="text-zinc-600">{sub.score}%</span>
                                <span className="text-[#0066FF] font-bold">{sub.points} pts</span>
                              </span>
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

        {/* Challenge Video Library */}
        {promptsList.length > 0 && (
          <div className="graphite-card p-5">
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono mb-4 border-b border-zinc-900 pb-2">
              Challenge Video Library
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {promptsList.map(p => (
                <div key={p.id} className="flex flex-col rounded-lg border border-zinc-800 bg-black overflow-hidden group">
                  <div className="relative aspect-video bg-zinc-950 overflow-hidden">
                    <video
                      src={`/videos/${p.id}.mp4`}
                      muted playsInline loop preload="none"
                      onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                      className="w-full h-full object-cover"
                    />
                    <span className={`absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase font-mono border ${DIFFICULTY_STYLE[p.difficulty]}`}>
                      {p.difficulty}
                    </span>
                  </div>
                  <div className="p-2 flex flex-col gap-2 flex-1">
                    <div>
                      <p className="text-[11px] font-bold text-white font-mono truncate">{p.id}</p>
                      <p className="text-[10px] text-zinc-500 truncate">{p.theme}</p>
                    </div>
                    {adminRooms.length > 0 ? (
                      adminRooms.map(room => (
                        <button
                          key={room.id}
                          onClick={() => handleUpdateRoomChallenge(room.id, p.id)}
                          className={`w-full rounded text-[10px] font-bold py-1.5 px-2 transition border font-mono uppercase tracking-wider ${
                            room.activeChallengeId === p.id
                              ? "bg-[#0066FF]/20 border-[#0066FF]/40 text-[#0066FF]"
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
                          }`}
                        >
                          {room.activeChallengeId === p.id ? "Active" : adminRooms.length > 1 ? `Set: ${room.name}` : "Set Challenge"}
                        </button>
                      ))
                    ) : (
                      <p className="text-[10px] text-zinc-600 font-mono text-center py-1">No rooms</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-zinc-600 font-mono">Hover a video to preview · Click to set as live challenge</p>
          </div>
        )}

      </div>
    </div>
  );
}
