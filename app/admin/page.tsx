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
  battleStartedAt: number | null;
  challengeDetails: ChallengeDetails | null;
  players: { playerName: string; lastSeen: number }[];
  submissionCount: number;
  submissions: { playerName: string; score: number; timeTakenToPrompt: number; videoScore?: number; compositeScore?: number; timestamp: number; prompt?: string; autoSubmitted?: boolean; videoAnalysisStatus?: "pending" | "completed" | "failed" }[];
  replayRequests: { roomId: string; playerName: string; timestamp: number }[];
}

interface PromptListItem {
  id: string;
  theme: string;
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
}

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
  const [localMaxUsers, setLocalMaxUsers] = useState(4);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which scored player's breakdown card is shown (0 = winner); arrows browse.
  const [breakdownIdx, setBreakdownIdx] = useState(0);
  // New challenge → new round: snap the breakdown card back to the winner.
  const activeChallengeIdForBreakdown = adminRooms[0]?.activeChallengeId ?? null;
  useEffect(() => { setBreakdownIdx(0); }, [activeChallengeIdForBreakdown]);

  const passwordRef = useRef(password);
  useEffect(() => { passwordRef.current = password; }, [password]);

  // Sync localMaxUsers when room data refreshes
  useEffect(() => {
    const room = adminRooms[0];
    if (room) setLocalMaxUsers(room.maxUsers);
  }, [adminRooms[0]?.maxUsers]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleUpdateRoomChallenge = async (roomId: string, challengeId: string | null) => {
    try {
      const res = await fetch(`/api/admin/rooms?id=${roomId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ challengeId }),
      });
      if (res.ok) setAdminRooms(await res.json());
      else alert("Failed to set challenge");
    } catch (e) { console.error(e); }
  };

  const handleRoomAction = async (roomId: string, action: string, extra?: Record<string, unknown>) => {
    if (action === "reset-session" && !confirm("Send every connected device back to the join screen? Scores are kept — the leaderboard is not cleared.")) return;
    if (action === "reset-scores" && !confirm("Clear all scores for this room?")) return;
    try {
      const res = await fetch(`/api/admin/rooms?id=${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) setAdminRooms(await res.json());
      else alert("Action failed");
    } catch (e) { console.error(e); }
  };

  const handleUpdateMaxUsers = async () => {
    const room = adminRooms[0];
    if (!room) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/rooms?id=${room.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ action: "update-max-users", maxUsers: localMaxUsers }),
      });
      if (res.ok) setAdminRooms(await res.json());
      else alert("Failed to update player count");
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleResetLeaderboard = async () => {
    if (!confirm("Clear the entire GLOBAL leaderboard? This cannot be undone.")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/leaderboard", {
        method: "DELETE",
        headers: { "x-admin-password": password },
      });
      if (res.ok) alert("Global leaderboard cleared.");
      else alert("Failed to clear leaderboard");
    } catch (e) { console.error(e); alert("Failed to clear leaderboard"); }
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

  // Derived: single room + hero
  const room = adminRooms[0] ?? null;
  const heroRoom = room?.activeChallengeId && room.challengeDetails ? room : null;

  function buildRoundRankings(r: RoomAdminState) {
    const submitted = r.submissions ?? [];
    // The final score is shown ONLY once video analysis resolves — composite
    // (text*0.2 + video*0.8) on success, or the text score if video is
    // unavailable. While analysis is pending it stays null so the admin shows
    // "scoring…" instead of the bare text score. A time-based safety net falls
    // back to the text score if a video never resolves (e.g. generation failed
    // or the player closed their tab) so a row never hangs on "scoring…".
    const ANALYSIS_TIMEOUT_MS = 180_000;
    const finalOf = (s: { compositeScore?: number; score: number; timestamp: number; videoAnalysisStatus?: string }) => {
      if (s.compositeScore != null) return s.compositeScore;
      if (s.videoAnalysisStatus === "failed") return s.score;
      if (Date.now() - s.timestamp > ANALYSIS_TIMEOUT_MS) return s.score;
      return null;
    };
    const submittedNames = new Set(submitted.map(s => s.playerName.toLowerCase()));
    const pending = (r.players ?? [])
      .filter(p => !submittedNames.has(p.playerName.toLowerCase()))
      .map(p => ({ playerName: p.playerName, score: null as number | null, finalScore: null as number | null, timeTakenToPrompt: null as number | null, prompt: undefined as string | undefined, videoScore: undefined as number | undefined, compositeScore: undefined as number | undefined, autoSubmitted: false }));
    const sorted = [...submitted].sort((a, b) => {
      const fa = finalOf(a);
      const fb = finalOf(b);
      if (fa === null && fb === null) return a.timeTakenToPrompt - b.timeTakenToPrompt;
      if (fa === null) return 1;
      if (fb === null) return -1;
      return fb !== fa ? fb - fa : a.timeTakenToPrompt - b.timeTakenToPrompt;
    });
    return [
      ...sorted.map(s => ({ playerName: s.playerName, score: s.score, finalScore: finalOf(s), timeTakenToPrompt: s.timeTakenToPrompt, prompt: s.prompt, videoScore: s.videoScore, compositeScore: s.compositeScore, autoSubmitted: !!s.autoSubmitted })),
      ...pending,
    ];
  }

  // ── AUTHENTICATED PANEL ─────────────────────────────────────────────────────
  return (
    <div className="relative">

      {/* ── HERO: fills viewport below navbar ────────────────────────────── */}
      <section className="h-[calc(100vh-3.5rem)] px-4 py-3 overflow-hidden flex flex-col">
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col gap-3 min-h-0">

          {/* Main hero content */}
          {heroRoom ? (
            <div className="flex-1 grid gap-3 lg:grid-cols-[7fr_3fr] min-h-0">

              {/* LEFT: Video */}
              <div className="relative rounded-xl overflow-hidden border border-zinc-700 bg-black min-h-0">
                <LiveVideo src={heroRoom.challengeDetails!.videoUrl} />

                <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                  <p className="text-xs uppercase font-bold text-zinc-400 font-mono tracking-wider">{heroRoom.name}</p>
                  <p className="text-sm font-bold text-white mt-0.5 font-mono">{heroRoom.challengeDetails!.theme}</p>
                </div>

                <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded border border-zinc-700 bg-black/90 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur pointer-events-none">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0066FF] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0066FF]" />
                  </span>
                  LIVE CHALLENGE
                </div>
              </div>

              {/* RIGHT: Round standings */}
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

                {/* Rankings list */}
                <div className="flex-1 space-y-1.5 overflow-y-auto min-h-0 pr-0.5">
                  {buildRoundRankings(heroRoom).length > 0 ? (
                    buildRoundRankings(heroRoom).map((entry, idx) => {
                      const submitted = entry.score !== null;
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
                              <p className={`text-sm font-bold font-mono leading-none ${idx === 0 && entry.finalScore != null ? "text-yellow-300" : ""}`}>
                                {entry.finalScore != null ? `${entry.finalScore} score` : "scoring..."}{entry.autoSubmitted ? " ⏱" : ""}
                              </p>
                              <p className={`text-[10px] font-mono mt-0.5 ${entry.finalScore == null ? "text-[#0066FF] animate-pulse" : "text-zinc-500"}`}>
                                {entry.finalScore == null
                                  ? "submitted · analyzing video…"
                                  : `${entry.autoSubmitted ? "auto · time up" : "submitted"} · ${entry.score}% prompt`}
                              </p>
                            </div>
                          ) : heroRoom.battleStartedAt && Date.now() - heroRoom.battleStartedAt < 60000 ? (
                            <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 font-mono animate-pulse flex-shrink-0">
                              Writing…
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-400 bg-zinc-600/10 border border-zinc-700/30 rounded px-1.5 py-0.5 font-mono flex-shrink-0">
                              Waiting
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

                {/* Player breakdown — arrows browse every scored player (0 = winner) */}
                {(() => {
                  const rankings = buildRoundRankings(heroRoom);
                  // Only players whose final score has resolved and whose prompt we have.
                  const scored = rankings.filter(e => e.finalScore !== null && e.prompt);
                  if (scored.length === 0) return null;
                  // Clamp: the list live-refreshes every 3s and can shrink between polls.
                  const idx = Math.min(breakdownIdx, scored.length - 1);
                  const entry = scored[idx];
                  const rank = rankings.indexOf(entry); // true standings position
                  const isWinner = rank === 0;
                  const textScore = entry.score ?? 0;
                  const videoScore = entry.videoScore;
                  const finalScore = entry.compositeScore ?? textScore;
                  const medal = rank < 3 ? ["🏆", "🥈", "🥉"][rank] : null;
                  return (
                    <div className={`flex-shrink-0 rounded-lg border p-3 space-y-2 ${
                      isWinner ? "border-yellow-500/30 bg-yellow-500/5" : "border-zinc-700 bg-black/30"
                    }`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base leading-none">{medal ?? <span className="text-[11px] font-mono font-bold text-zinc-500">#{rank + 1}</span>}</span>
                          <div className="min-w-0">
                            <p className={`text-[10px] uppercase font-bold tracking-wider font-mono ${isWinner ? "text-yellow-500/70" : "text-zinc-500"}`}>
                              {isWinner ? "Winner Breakdown" : `#${rank + 1} Breakdown`}
                            </p>
                            <p className={`text-sm font-bold font-mono leading-tight truncate ${isWinner ? "text-yellow-200" : "text-white"}`}>
                              {entry.playerName}
                            </p>
                          </div>
                        </div>
                        {/* Prev / next player arrows */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => setBreakdownIdx(Math.max(0, idx - 1))}
                            disabled={idx === 0}
                            title="Previous player"
                            className="h-6 w-6 flex items-center justify-center rounded border border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:text-white hover:border-zinc-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                          </button>
                          <span className="text-[10px] font-mono text-zinc-500 px-0.5 select-none">{idx + 1}/{scored.length}</span>
                          <button
                            onClick={() => setBreakdownIdx(Math.min(scored.length - 1, idx + 1))}
                            disabled={idx >= scored.length - 1}
                            title="Next player"
                            className="h-6 w-6 flex items-center justify-center rounded border border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:text-white hover:border-zinc-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                          </button>
                        </div>
                      </div>
                      <div className="rounded border border-zinc-800 bg-black/40 px-2.5 py-2">
                        <p className="text-[10px] uppercase font-bold text-zinc-500 font-mono mb-1">Their Prompt</p>
                        <p className="text-xs text-zinc-200 font-mono leading-relaxed italic">"{entry.prompt}"</p>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="rounded border border-zinc-800 bg-black/40 px-2 py-1.5 text-center">
                          <p className="text-[9px] uppercase font-bold text-zinc-500 font-mono leading-tight">Text</p>
                          <p className="text-sm font-bold text-white font-mono">{textScore}%</p>
                        </div>
                        <div className={`rounded border px-2 py-1.5 text-center ${videoScore != null ? "border-zinc-700 bg-black/40" : "border-zinc-800/40 bg-black/20"}`}>
                          <p className="text-[9px] uppercase font-bold text-zinc-500 font-mono leading-tight">Video</p>
                          <p className={`text-sm font-bold font-mono ${videoScore != null ? "text-white" : "text-zinc-600"}`}>
                            {videoScore != null ? `${videoScore}%` : "—"}
                          </p>
                        </div>
                        <div className={`rounded border px-2 py-1.5 text-center ${isWinner ? "border-yellow-500/30 bg-yellow-500/8" : "border-[#0066FF]/30 bg-[#0066FF]/10"}`}>
                          <p className={`text-[9px] uppercase font-bold font-mono leading-tight ${isWinner ? "text-yellow-600" : "text-[#0066FF]"}`}>Final</p>
                          <p className={`text-sm font-bold font-mono ${isWinner ? "text-yellow-300" : "text-white"}`}>{finalScore}%</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-zinc-500 font-mono truncate">{heroRoom.challengeDetails?.theme}</p>
                        <p className={`text-xs font-bold font-mono ${isWinner ? "text-yellow-300" : "text-white"}`}>{entry.finalScore} final</p>
                      </div>
                    </div>
                  );
                })()}

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
                    onClick={() => handleRoomAction(heroRoom.id, "reset-session")}
                    className="flex-1 text-[10px] uppercase font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-300 rounded px-2 py-1.5 transition"
                  >
                    Reset Session
                  </button>
                </div>
              </div>
            </div>

          ) : (
            /* No active challenge */
            <div className="flex-1 rounded-xl border border-dashed border-zinc-800 bg-black/30 flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-full border border-zinc-700 flex items-center justify-center mb-3">
                <svg className="h-5 w-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
              </div>
              <p className="text-sm font-bold text-zinc-500 font-mono uppercase tracking-wider">No Active Challenge</p>
              <p className="text-xs text-zinc-600 font-mono mt-1.5 max-w-xs">
                Set a challenge video below — it will appear here live.
              </p>
              <p className="text-[10px] text-zinc-700 font-mono mt-1">↓ Scroll down to manage</p>
            </div>
          )}

        </div>
      </section>

      {/* ── BELOW FOLD: Room Controls + Library ──────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">

        {/* Single Room Control Panel */}
        {room && (
          <div className="graphite-card p-5">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-5">
              <div>
                <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono">Room Controls</h2>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">
                  {room.players?.length || 0} / {room.maxUsers} players connected
                </p>
              </div>
              <span className="text-[10px] text-zinc-700 font-mono border border-zinc-800 rounded px-2 py-1">
                {room.id}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

              {/* Max Players */}
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-500 font-mono mb-2">Max Players</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLocalMaxUsers(v => Math.max(1, v - 1))}
                    className="h-8 w-8 flex items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-600 font-bold text-base transition"
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-mono font-bold text-white text-base tabular-nums">
                    {localMaxUsers}
                  </span>
                  <button
                    onClick={() => setLocalMaxUsers(v => Math.min(20, v + 1))}
                    className="h-8 w-8 flex items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-600 font-bold text-base transition"
                  >
                    +
                  </button>
                  <button
                    onClick={handleUpdateMaxUsers}
                    disabled={loading || localMaxUsers === room.maxUsers}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed ml-1"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Set Challenge */}
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-500 font-mono mb-2">Challenge</label>
                <div className="flex items-center gap-2">
                  <select
                    value={room.activeChallengeId || ""}
                    onChange={e => handleUpdateRoomChallenge(room.id, e.target.value || null)}
                    className="flex-1 rounded border border-zinc-800 bg-zinc-950 text-xs text-white px-2.5 py-1.5 focus:outline-none focus:border-[#0066FF] min-w-0"
                  >
                    <option value="">— No challenge —</option>
                    {promptsList.map(p => (
                      <option key={p.id} value={p.id}>{p.id} · {p.theme}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRoomAction(room.id, "assign-random")}
                    title="Pick random challenge"
                    className="h-8 w-8 flex items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-600 transition flex-shrink-0"
                  >
                    🎲
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-500 font-mono mb-2">Actions</label>
                <div className="space-y-2">
                  <button
                    onClick={() => handleRoomAction(room.id, "reset-session")}
                    className="w-full text-xs font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-300 rounded px-4 py-1.5 transition"
                  >
                    Reset Session
                  </button>
                  <button
                    onClick={handleResetLeaderboard}
                    disabled={loading}
                    className="w-full text-xs font-bold font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-300 rounded px-4 py-1.5 transition disabled:opacity-40"
                  >
                    Reset Global Leaderboard
                  </button>
                </div>
              </div>
            </div>

            {/* Battle control — waiting / start / in progress */}
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-zinc-800 bg-black/40 px-4 py-3">
              <div className="flex items-center gap-2.5">
                {room.battleStartedAt ? (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-xs font-bold font-mono text-emerald-400 uppercase tracking-wider">Battle in progress</span>
                  </>
                ) : room.activeChallengeId ? (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-xs font-bold font-mono text-amber-300 uppercase tracking-wider">
                      Waiting for players — {room.players?.length || 0}/{room.maxUsers} joined
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-mono text-zinc-500">Set a challenge below to start a battle.</span>
                )}
              </div>
              {room.activeChallengeId && !room.battleStartedAt && (
                <button
                  onClick={() => handleRoomAction(room.id, "start-battle")}
                  className="btn-primary text-xs px-4 py-2 font-bold uppercase tracking-wider whitespace-nowrap"
                >
                  ▶ Start Battle Now
                </button>
              )}
            </div>

            {/* Replay requests notice */}
            {room.replayRequests && room.replayRequests.length > 0 && (
              <div className="mt-4 flex items-start justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-[11px] text-amber-300 font-mono leading-relaxed">
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

            {/* Connected players */}
            {room.players && room.players.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-900">
                <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-mono mb-2">Connected Players</p>
                <div className="flex flex-wrap gap-2">
                  {room.players.map(p => {
                    const hasSub = room.submissions?.some(s => s.playerName.toLowerCase() === p.playerName.toLowerCase());
                    return (
                      <div key={p.playerName} className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono font-semibold ${hasSub ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-300"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${hasSub ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
                        {p.playerName}
                        {hasSub && <span className="text-[10px] text-emerald-500">✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

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
                  </div>
                  <div className="p-2 flex flex-col gap-2 flex-1">
                    <div>
                      <p className="text-[11px] font-bold text-white font-mono truncate">{p.id}</p>
                      <p className="text-[10px] text-zinc-500 truncate">{p.theme}</p>
                    </div>
                    {room ? (
                      <button
                        onClick={() => handleUpdateRoomChallenge(room.id, p.id)}
                        className={`w-full rounded text-[10px] font-bold py-1.5 px-2 transition border font-mono uppercase tracking-wider ${
                          room.activeChallengeId === p.id
                            ? "bg-[#0066FF]/20 border-[#0066FF]/40 text-[#0066FF]"
                            : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
                        }`}
                      >
                        {room.activeChallengeId === p.id ? "Active" : "Set Challenge"}
                      </button>
                    ) : (
                      <p className="text-[10px] text-zinc-600 font-mono text-center py-1">Loading…</p>
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
