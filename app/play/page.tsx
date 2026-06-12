"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { getPlayerName, setPlayerName } from "@/lib/leaderboard";
import type { ScoreResult, LeaderboardEntry } from "@/lib/types";

/* ─── Types ─────────────────────────────────────────────────────────────── */
type Phase = "lobby" | "loading" | "playing" | "generating" | "results";

interface Challenge {
  challengeId: string;
  videoUrl: string;
  difficulty: "easy" | "medium" | "hard";
  theme: string;
}

interface UserVideo {
  videoUrl: string;
  promptUsed: string;
}

interface RoomListItem {
  id: string;
  name: string;
  maxUsers: number;
  activePlayersCount: number;
  activeChallengeId: string | null;
}

interface RoomPlayerStatus {
  playerName: string;
  hasSubmitted: boolean;
  score: number | null;
}

interface RoomState {
  id: string;
  name: string;
  maxUsers: number;
  activeChallengeId: string | null;
  challengeDetails: Challenge | null;
  players: RoomPlayerStatus[];
  submissions: { playerName: string; score: number; timestamp: number }[];
}

/* ─── Constants ─────────────────────────────────────────────────────────── */
const DIFFICULTY_STYLE = {
  easy:   "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-400   bg-amber-500/10   border-amber-500/30",
  hard:   "text-rose-400    bg-rose-500/10    border-rose-500/30",
};

const GEN_MSGS = [
  "Synthesizing neural assets…",
  "Rendering cinematic sequences…",
  "Assembling temporal dynamics…",
  "Evaluating frame interpolation…",
  "Finalizing high-fidelity output…",
];

const SCORE_MSGS = [
  "Comparing prompt semantics…",
  "Measuring conceptual resonance…",
  "Validating architectural intent…",
  "Synthesizing final similarity score…",
];

/* ─── Spinning message component ─────────────────────────────────────────── */
function SpinningMessages({ msgs }: { msgs: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % msgs.length), 2500);
    return () => clearInterval(t);
  }, [msgs.length]);
  return (
    <AnimatePresence mode="wait">
      <motion.p
        key={i}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25 }}
        className="text-sm font-mono text-zinc-300"
      >
        {msgs[i]}
      </motion.p>
    </AnimatePresence>
  );
}

/* ─── Original challenge video panel ─────────────────────────────────────── */
function ChallengeVideo({ src }: { src: string }) {
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
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-zinc-700 bg-black">
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        loop
        preload="auto"
        className="h-full w-full object-cover"
      />
      {/* Sync Badge */}
      <div className="absolute top-4 left-4 flex items-center gap-2 rounded border border-zinc-700 bg-black/90 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0066FF] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0066FF]" />
        </span>
        LIVE FEED
      </div>
    </div>
  );
}

/* ─── Synced dual-video for results ──────────────────────────────────────── */
function DualVideo({ originalSrc, userSrc }: { originalSrc: string; userSrc: string }) {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(0);
  const [playing, setPlaying] = useState(false);

  const tryPlay = useCallback(() => {
    if (!aRef.current || !bRef.current) return;
    aRef.current.currentTime = 0;
    bRef.current.currentTime = 0;
    Promise.all([aRef.current.play(), bRef.current.play()])
      .then(() => setPlaying(true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (ready >= 2) tryPlay();
  }, [ready, tryPlay]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      if (!aRef.current || !bRef.current) return;
      const diff = Math.abs(aRef.current.currentTime - bRef.current.currentTime);
      if (diff > 0.25) bRef.current.currentTime = aRef.current.currentTime;
    }, 150);
    return () => clearInterval(t);
  }, [playing]);

  const toggle = () => {
    if (!aRef.current || !bRef.current) return;
    if (playing) {
      aRef.current.pause();
      bRef.current.pause();
      setPlaying(false);
    } else {
      Promise.all([aRef.current.play(), bRef.current.play()])
        .then(() => setPlaying(true))
        .catch(() => {});
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Original */}
        <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 bg-[#09090b]">
          <video
            ref={aRef}
            src={originalSrc}
            muted
            playsInline
            loop
            preload="auto"
            onCanPlay={() => setReady((n) => Math.min(n + 1, 2))}
            className="h-full w-full object-cover"
          />
          <span className="absolute top-3 left-3 rounded border border-zinc-700 bg-black/90 px-2.5 py-1 text-xs font-bold tracking-wider text-zinc-300 uppercase">
            ORIGINAL CHALLENGE
          </span>
        </div>

        {/* User */}
        <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 bg-[#09090b]">
          <video
            ref={bRef}
            src={userSrc}
            muted
            playsInline
            loop
            preload="auto"
            onCanPlay={() => setReady((n) => Math.min(n + 1, 2))}
            className="h-full w-full object-cover"
          />
          <span className="absolute top-3 left-3 rounded border border-zinc-700 bg-black/90 px-2.5 py-1 text-xs font-bold tracking-wider text-[#0066FF] uppercase">
            YOUR GENERATION
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-900 pt-4">
        <button onClick={toggle} className="btn-secondary py-1.5 px-4 text-sm flex items-center gap-2">
          {playing ? (
            <>
              <span className="h-2.5 w-2.5 bg-amber-400 rounded-full animate-pulse" />
              Pause Playback
            </>
          ) : (
            <>
              <span className="h-2.5 w-2.5 bg-emerald-400 rounded-full" />
              Play Side-by-Side
            </>
          )}
        </button>
        <span className="text-xs text-zinc-500 font-mono">
          Temporal Sync Lock Active · 540p
        </span>
      </div>
    </div>
  );
}

/* ─── Score Display Panel ────────────────────────────────────────────────── */
function ScorePanel({ score, feedback }: { score: number; feedback: string }) {
  const label =
    score >= 80 ? "Superb Alignment" :
    score >= 50 ? "Moderate Resonance" :
    "Semantic Deviation";

  return (
    <div className="graphite-card p-5 flex items-center gap-5">
      {/* Circle Indicator */}
      <div className="relative flex-shrink-0 h-20 w-20 flex items-center justify-center">
        <svg className="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="16" fill="none" stroke="#27272a" strokeWidth="2.5" />
          <motion.circle
            cx="18" cy="18" r="16"
            fill="none"
            stroke="#0066FF"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ strokeDasharray: "0 100" }}
            animate={{ strokeDasharray: `${score} 100` }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <span className="absolute text-xl font-bold tracking-tight text-white font-mono">{score}</span>
      </div>
      <div>
        <p className="text-sm font-bold text-white tracking-tight">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400 sm:text-sm">{feedback}</p>
      </div>
    </div>
  );
}

/* ─── Main Play page Component ───────────────────────────────────────────── */
export default function PlayPage() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [playerName, setPlayerNameState] = useState("");
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  
  // Room state
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  
  // Challenge & gameplay state
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [prompt, setPrompt] = useState("");
  const [userVideo, setUserVideo] = useState<UserVideo | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  
  // Highscore Lists
  const [globalLeaderboard, setGlobalLeaderboard] = useState<LeaderboardEntry[]>([]);
  
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "processing">("idle");

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const activeChallengeIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceFinalRef = useRef<string>("");
  // Holds score + context needed by the polling effect (avoids stale-closure deps)
  const pollCtxRef = useRef<{ score: ScoreResult; playerName: string; roomId: string | null; prompt: string } | null>(null);

  // Load player name on mount
  useEffect(() => {
    const saved = getPlayerName();
    if (saved) setPlayerNameState(saved);
  }, []);

  // Fetch available rooms
  const fetchRooms = async () => {
    setLoadingRooms(true);
    try {
      const res = await fetch("/api/rooms");
      if (res.ok) {
        const data = await res.json();
        setRooms(data);
      }
    } catch (e) {
      console.error("Failed to load rooms:", e);
    }
    setLoadingRooms(false);
  };

  useEffect(() => {
    if (phase === "lobby") {
      fetchRooms();
    }
  }, [phase]);

  // Sync Room Session Heartbeat
  useEffect(() => {
    if (phase === "lobby" || !selectedRoomId) return;

    const heartbeat = async () => {
      try {
        const res = await fetch("/api/rooms/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: selectedRoomId, playerName }),
        });
        
        if (res.ok) {
          const data = (await res.json()) as RoomState;
          setRoomState(data);

          // If the challenge ID changed, sync with it!
          if (data.activeChallengeId !== activeChallengeIdRef.current) {
            activeChallengeIdRef.current = data.activeChallengeId;
            
            if (data.challengeDetails) {
              setChallenge(data.challengeDetails);
              // Clear previous entries
              setPrompt("");
              setUserVideo(null);
              setResult(null);
              if (phase !== "playing") {
                setPhase("playing");
              }
            } else {
              setChallenge(null);
            }
          }
        } else {
          // Room full or deleted
          setSelectedRoomId(null);
          setPhase("lobby");
          setError("Session full or room no longer exists.");
        }
      } catch (e) {
        console.error("Heartbeat sync failed:", e);
      }
    };

    // Trigger immediately and then poll
    heartbeat();
    const t = setInterval(heartbeat, 3000);
    return () => clearInterval(t);
  }, [selectedRoomId, playerName, phase]);

  // Load random challenge (Solo Mode)
  const loadSoloChallenge = async () => {
    setPhase("loading");
    setChallenge(null);
    setPrompt("");
    setUserVideo(null);
    setResult(null);
    setError(null);
    setSelectedRoomId(null);

    try {
      const res = await fetch("/api/challenge");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to fetch challenge");
      setChallenge(data);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load solo challenge.");
      setPhase("playing");
    }
  };

  // Poll for video result while in "generating" phase
  useEffect(() => {
    if (phase !== "generating" || !requestId) return;
    let cancelled = false;

    const finish = async (videoUrl: string | null) => {
      if (cancelled || !pollCtxRef.current) return;
      const { score, playerName: name, roomId, prompt: p } = pollCtxRef.current;
      try {
        const r = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName: name, score: score.score, roomId: roomId || undefined }),
        });
        if (r.ok) setGlobalLeaderboard(await r.json());
      } catch {}
      if (videoUrl) setUserVideo({ videoUrl, promptUsed: p });
      setResult(score);
      setRequestId(null);
      setPhase("results");
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/generate-poll?requestId=${requestId}`);
        const data = await res.json();
        if (data.status === "COMPLETED") await finish(data.videoUrl);
        else if (data.error) await finish(null);
      } catch {}
    };

    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, phase]);

  // Submit Prompt — fire-and-forget to queue, score in parallel
  const handleSubmitPrompt = async () => {
    if (!challenge || !prompt.trim()) return;
    const name = playerName.trim() || "Anonymous Player";
    setPlayerName(name);
    setPlayerNameState(name);
    setSubmitting(true);
    setError(null);

    try {
      const [genRes, scoreRes] = await Promise.all([
        fetch("/api/generate-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userPrompt: prompt.trim() }),
        }),
        fetch("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: challenge.challengeId, userPrompt: prompt.trim() }),
        }),
      ]);

      const genData = await genRes.json();
      const scoreData = (await scoreRes.json()) as ScoreResult;
      if (!scoreRes.ok) throw new Error("Scoring failed");

      // Store context for the polling effect to use
      pollCtxRef.current = { score: scoreData, playerName: name, roomId: selectedRoomId, prompt: prompt.trim() };

      if (!genData.requestId) {
        // FAL_KEY not set or generation skipped — show results with score only
        const r = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName: name, score: scoreData.score, roomId: selectedRoomId || undefined }),
        });
        if (r.ok) setGlobalLeaderboard(await r.json());
        setResult(scoreData);
        setPhase("results");
      } else {
        setRequestId(genData.requestId);
        setPhase("generating");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  // Voice-to-text: live via Web Speech API + accurate final via Whisper
  const startVoice = async () => {
    voiceFinalRef.current = "";
    setVoiceStatus("recording");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) voiceFinalRef.current += e.results[i][0].transcript + " ";
          else interim = e.results[i][0].transcript;
        }
        setPrompt(voiceFinalRef.current + interim);
      };
      r.onerror = () => {};
      r.start();
      recognitionRef.current = r;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setVoiceStatus("processing");
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const fd = new FormData();
          fd.append("audio", blob, "recording.webm");
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          const data = await res.json();
          if (data.text?.trim()) setPrompt(data.text.trim());
        } catch {}
        setVoiceStatus("idle");
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch {
      setVoiceStatus("idle");
    }
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  // Fetch Global leaderboard for display in Results
  useEffect(() => {
    if (phase === "results") {
      fetch("/api/leaderboard")
        .then(res => res.json())
        .then(data => setGlobalLeaderboard(data))
        .catch(err => console.error("Global leaderboard load failed:", err));
    }
  }, [phase]);

  // Join Room button click
  const handleJoinRoom = (room: RoomListItem) => {
    if (!playerName.trim()) {
      setError("Please enter your name first.");
      return;
    }
    setError(null);
    setPlayerName(playerName.trim());
    setSelectedRoomId(room.id);
    setPhase("loading");
  };

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] flex flex-col justify-between overflow-hidden">
      <div className="relative mx-auto w-full max-w-6xl px-4 py-6 flex-1 flex flex-col min-h-0">

        {/* ── HEADER BAR ──────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3.5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight text-white uppercase">
              {phase === "lobby" ? "Select Game Mode" : selectedRoomId ? "Multiplayer Synced Match" : "Solo Match Practice"}
            </h1>
            {selectedRoomId && roomState && (
              <span className="flex items-center gap-2 rounded bg-[#0066FF]/10 border border-[#0066FF]/30 px-3 py-1 text-xs text-[#0066FF] font-mono font-semibold">
                <span className="h-2 w-2 rounded-full bg-[#0066FF] sync-dot" />
                {roomState.name}
              </span>
            )}
            {challenge && phase === "playing" && (
              <>
                <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase font-mono border ${DIFFICULTY_STYLE[challenge.difficulty]}`}>
                  {challenge.difficulty}
                </span>
                <span className="text-xs font-semibold text-zinc-500 font-mono hidden sm:inline">
                  Theme: {challenge.theme}
                </span>
              </>
            )}
          </div>

          {/* User Badge */}
          {phase !== "lobby" && (
            <div className="flex items-center gap-3 rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5">
              <span className="text-xs text-zinc-500 font-mono">User:</span>
              <span className="text-xs font-bold text-white font-mono">{playerName}</span>
              <button
                onClick={() => {
                  setSelectedRoomId(null);
                  setPhase("lobby");
                  setChallenge(null);
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200 ml-3 border-l border-zinc-800 pl-3 font-medium"
              >
                Exit Game
              </button>
            </div>
          )}
        </div>

        {/* ── MAIN PLAY AREA ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          <AnimatePresence mode="wait">

            {/* LOBBY SCREEN ──────────────────────────────────────────── */}
            {phase === "lobby" && (
              <motion.div
                key="lobby"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="perspective-1000 grid gap-6 md:grid-cols-2 max-w-4xl mx-auto w-full my-auto"
              >
                {/* Name Input & Solo Play */}
                <motion.div 
                  whileHover={{ rotateY: 5, rotateX: -2, z: 20 }}
                  className="graphite-card p-6 flex flex-col justify-between preserve-3d"
                >
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight">1. Participant Registry</h2>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      Specify your username below to log your scores on the live leaderboards.
                    </p>
                    <div className="mt-5">
                      <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">
                        Participant Username
                      </label>
                      <input
                        type="text"
                        value={playerName}
                        onChange={(e) => setPlayerNameState(e.target.value)}
                        placeholder="e.g. CyberRider"
                        maxLength={18}
                        className="input-field"
                      />
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-zinc-850">
                    <h3 className="text-sm font-bold text-white">Option A: Practice Mode</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      Learn the visual semantics by playing random challenge clips.
                    </p>
                    <button
                      onClick={loadSoloChallenge}
                      className="btn-secondary w-full mt-4 text-sm"
                    >
                      Start Solo Match
                    </button>
                  </div>
                </motion.div>

                {/* Multiplayer Booth Rooms */}
                <motion.div 
                  whileHover={{ rotateY: -5, rotateX: -2, z: 20 }}
                  className="graphite-card p-6 flex flex-col preserve-3d"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white tracking-tight">2. Sync Multiplayer</h2>
                    <button
                      onClick={fetchRooms}
                      disabled={loadingRooms}
                      className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1.5 transition"
                    >
                      <svg className={`h-4 w-4 ${loadingRooms ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.235" />
                      </svg>
                      Scan Rooms
                    </button>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Join an active battle session controlled by the booth admin.
                  </p>

                  <div className="mt-5 flex-1 overflow-y-auto max-h-[200px] space-y-2 pr-1">
                    {rooms.map((room) => (
                      <div
                        key={room.id}
                        className="flex items-center justify-between p-3 rounded border border-zinc-800 bg-[#040405] hover:border-zinc-700 transition"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white">{room.name}</p>
                          <p className="text-xs text-zinc-500 font-mono mt-1">
                            Laptops Joined: {room.activePlayersCount} / {room.maxUsers}
                          </p>
                        </div>
                        <button
                          onClick={() => handleJoinRoom(room)}
                          disabled={room.activePlayersCount >= room.maxUsers && !playerName}
                          className="btn-primary py-1.5 px-4 text-xs font-bold"
                        >
                          Join Battle
                        </button>
                      </div>
                    ))}
                    {rooms.length === 0 && !loadingRooms && (
                      <div className="text-center py-8 text-xs text-zinc-500 font-mono border border-dashed border-zinc-800 rounded">
                        No active battle sessions detected.<br />Create a room from the admin panel to start.
                      </div>
                    )}
                  </div>
                  {error && <p className="text-xs text-rose-400 text-center mt-3 font-semibold">{error}</p>}
                </motion.div>
              </motion.div>
            )}

            {/* WAITING FOR CHALLENGE / LOADING ─────────────────────── */}
            {phase === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center flex-1 py-20"
              >
                <div className="h-8 w-8 rounded-full border-2 border-[#0066FF] border-t-transparent animate-spin mb-4" />
                <p className="text-sm font-mono text-zinc-400">Calibrating session feeds…</p>
              </motion.div>
            )}

            {/* PLAYING PHASE (Left video, Right prompting) ─────────── */}
            {phase === "playing" && (
              <motion.div
                key="playing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid gap-4 flex-1 min-h-0 lg:grid-cols-[1fr_420px]"
              >
                {/* LEFT: Video Player or Waiting for challenge */}
                <div className="relative min-h-[300px] lg:min-h-0 flex-1">
                  {challenge ? (
                    <ChallengeVideo src={challenge.videoUrl} />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full rounded-lg border border-dashed border-zinc-700 bg-[#040405]/70 text-center p-6 backdrop-blur-md">
                      <div className="h-8 w-8 rounded-full border border-dashed border-[#0066FF] animate-spin mb-4" />
                      <p className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Awaiting Challenge Video</p>
                      <p className="text-xs sm:text-sm text-zinc-500 mt-2 max-w-sm">
                        The admin is picking the next challenge clip. Prepare your prompt semantics!
                      </p>
                    </div>
                  )}
                </div>

                {/* RIGHT: Prompt Input Panel */}
                <div className="flex flex-col gap-4 min-w-0 justify-between">
                  {/* Sync status & active players */}
                  {selectedRoomId && roomState && (
                    <div className="graphite-card p-4">
                      <p className="text-xs uppercase font-bold text-zinc-500 font-mono tracking-wider">
                        Connected Booth Laptops ({roomState.players?.length})
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {roomState.players?.map((p) => (
                          <span
                            key={p.playerName}
                            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-mono border ${
                              p.hasSubmitted
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold"
                                : p.playerName.toLowerCase() === playerName.toLowerCase()
                                ? "bg-[#0066FF]/10 border-[#0066FF]/30 text-[#0066FF] font-semibold"
                                : "bg-zinc-900/60 border-zinc-800 text-zinc-500"
                            }`}
                          >
                            <span>{p.playerName}</span>
                            {p.hasSubmitted && <span className="text-xs">✓</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Instruction */}
                  <div className="graphite-card p-4">
                    <h3 className="text-sm font-bold text-white uppercase tracking-tight">Decryption Guidance</h3>
                    <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                      Guess the original words. Aim for details regarding the <span className="text-[#0066FF] font-semibold">subject, environment background, illumination, camera lens, speed, and cinematic aesthetic</span>.
                    </p>
                  </div>

                  {/* Textarea */}
                  <div className="graphite-card flex-1 flex flex-col min-h-[160px] overflow-hidden">
                    <textarea
                      ref={promptRef}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={voiceStatus === "recording" ? "Listening... speak now" : "Enter prompt description..."}
                      maxLength={1000}
                      disabled={!challenge}
                      className={`flex-1 resize-none bg-transparent p-4 text-xs sm:text-sm leading-relaxed text-white outline-none ${voiceStatus === "recording" ? "placeholder:text-[#0066FF]/60 placeholder:animate-pulse" : "placeholder:text-zinc-700"}`}
                    />
                    <div className="flex items-center justify-between border-t border-zinc-900 px-4 py-2.5 bg-black/60">
                      <span className="text-xs text-zinc-500 font-mono">{prompt.length}/1000 chars</span>
                      <div className="flex items-center gap-3">
                        {/* Voice input button */}
                        <button
                          type="button"
                          onClick={voiceStatus === "recording" ? stopVoice : startVoice}
                          disabled={!challenge || voiceStatus === "processing"}
                          title={voiceStatus === "recording" ? "Stop recording" : "Speak your prompt"}
                          className={`flex items-center gap-1.5 rounded text-xs font-semibold px-2.5 py-1 transition border ${
                            voiceStatus === "recording"
                              ? "bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse"
                              : voiceStatus === "processing"
                              ? "bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed"
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600"
                          }`}
                        >
                          {voiceStatus === "processing" ? (
                            <>
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                              </svg>
                              <span>Transcribing</span>
                            </>
                          ) : voiceStatus === "recording" ? (
                            <>
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                              <span>Stop</span>
                            </>
                          ) : (
                            <>
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <rect x="9" y="2" width="6" height="13" rx="3" />
                                <path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6" />
                              </svg>
                              <span>Voice</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => { setPrompt(""); promptRef.current?.focus(); }}
                          disabled={!prompt}
                          className="text-xs font-semibold text-zinc-500 hover:text-white transition disabled:opacity-0"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>

                  {error && <p className="text-xs text-rose-400 text-center font-semibold">{error}</p>}

                  {/* Action buttons */}
                  <div className="space-y-2">
                    <button
                      onClick={handleSubmitPrompt}
                      disabled={!prompt.trim() || !challenge || submitting}
                      className="btn-primary w-full py-3 text-sm font-bold uppercase tracking-wider"
                    >
                      Submit & Render Video →
                    </button>
                    {!selectedRoomId && (
                      <button
                        onClick={loadSoloChallenge}
                        className="btn-secondary w-full py-2.5 text-xs font-semibold"
                      >
                        Skip Challenge
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* GENERATING LOAD SCREEN ───────────────────────────────── */}
            {phase === "generating" && (
              <motion.div
                key="generating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center flex-1 max-w-md mx-auto py-12"
              >
                {/* Ring animation */}
                <div className="relative h-20 w-20 mb-6">
                  <div className="absolute inset-0 rounded-full border border-dashed border-[#0066FF]/30 animate-spin" style={{ animationDuration: "8s" }} />
                  <div className="absolute inset-2.5 rounded-full border border-t-[#0066FF] border-r-transparent border-b-transparent border-l-[#0066FF] animate-spin" style={{ animationDuration: "1.5s" }} />
                </div>

                <div className="text-center space-y-2">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Running Neural Model</h2>
                  <SpinningMessages msgs={GEN_MSGS} />
                  <p className="text-xs text-zinc-500 font-mono">Synthesizing cinematic pixels (approx. 30s)</p>
                </div>

                <div className="mt-8 w-full graphite-card p-5 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0066FF] font-mono mb-2">My Prompt Entry</p>
                  <p className="text-sm leading-relaxed text-zinc-300 font-mono max-h-[120px] overflow-y-auto italic">"{prompt}"</p>
                </div>
                
                <div className="mt-6 flex items-center gap-2">
                  <SpinningMessages msgs={SCORE_MSGS} />
                </div>
              </motion.div>
            )}

            {/* RESULTS PHASE (Side-by-side local vs global leaderboards) ─ */}
            {phase === "results" && challenge && result && (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-4 flex-1 overflow-y-auto pr-1"
              >
                {/* Result header cards */}
                <div className="grid gap-4 sm:grid-cols-[1fr_360px]">
                  <ScorePanel score={result.score} feedback={result.feedback} />
                  
                  {/* Prompt reveal summary */}
                  <div className="graphite-card p-5 flex flex-col justify-between">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-mono">Evaluated Prompt</p>
                      <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed mt-2 italic font-mono">"{prompt}"</p>
                    </div>
                  </div>
                </div>

                {/* Side-by-Side Dual Video */}
                {userVideo && <DualVideo originalSrc={challenge.videoUrl} userSrc={userVideo.videoUrl} />}

                {/* Side-by-Side LEADERBOARDS (Local vs Global) */}
                <div className="grid gap-4 md:grid-cols-2 mt-2">
                  
                  {/* LOCAL LEADERBOARD */}
                  <div className="graphite-card p-4">
                    <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center justify-between border-b border-zinc-900 pb-2.5">
                      <span>Room Standings ({roomState?.name || "Local"})</span>
                      {selectedRoomId && (
                        <span className="text-[10px] text-[#0066FF] font-mono font-semibold normal-case">
                          Live Synced
                        </span>
                      )}
                    </h3>
                    
                    <div className="mt-3 space-y-2 overflow-y-auto max-h-[200px] pr-1">
                      {(roomState?.submissions || []).length > 0 ? (
                        roomState?.submissions.map((sub, idx) => {
                          const isMe = sub.playerName.toLowerCase() === playerName.toLowerCase();
                          return (
                            <div
                              key={sub.playerName + idx}
                              className={`flex items-center justify-between p-2.5 rounded text-xs sm:text-sm border ${
                                isMe
                                  ? "bg-[#0066FF]/15 border-[#0066FF]/35 text-white font-bold"
                                  : "bg-black/40 border-zinc-900 text-zinc-300"
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="w-5 text-center font-mono font-bold text-zinc-600">{idx + 1}</span>
                                <span className="truncate max-w-[150px]">{sub.playerName}</span>
                              </div>
                              <span className="font-mono text-[#0066FF] font-bold">{sub.score}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center py-8 text-xs sm:text-sm text-zinc-500 font-mono">
                          No scores recorded for this room session yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* GLOBAL LEADERBOARD */}
                  <div className="graphite-card p-4">
                    <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono border-b border-zinc-900 pb-2.5">
                      Global summit Highscores
                    </h3>
                    
                    <div className="mt-3 space-y-2 overflow-y-auto max-h-[200px] pr-1">
                      {globalLeaderboard.slice(0, 10).map((entry, idx) => {
                        const isMe = entry.playerName.toLowerCase() === playerName.toLowerCase();
                        return (
                          <div
                            key={entry.playerName + entry.timestamp + idx}
                            className={`flex items-center justify-between p-2.5 rounded text-xs sm:text-sm border ${
                              isMe
                                ? "bg-white/5 border-[#0066FF]/35 text-white font-bold"
                                : "bg-black/40 border-zinc-900 text-zinc-300"
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="w-5 text-center font-mono font-bold text-zinc-600">{idx + 1}</span>
                              <span className="truncate max-w-[150px]">{entry.playerName}</span>
                            </div>
                            <span className="font-mono text-zinc-300">{entry.score}</span>
                          </div>
                        );
                      })}
                      {globalLeaderboard.length === 0 && (
                        <div className="text-center py-8 text-xs sm:text-sm text-zinc-500 font-mono">
                          No global highscores loaded.
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                {/* Final action bar */}
                <div className="flex gap-3 border-t border-zinc-900 pt-4 mt-2">
                  {selectedRoomId ? (
                    <div className="flex-1 text-center py-2.5 text-xs sm:text-sm text-zinc-400 font-mono graphite-card flex items-center justify-center gap-2">
                      <span className="h-2 w-2 bg-[#0066FF] rounded-full animate-ping" />
                      Waiting for Admin to choose next challenge video...
                    </div>
                  ) : (
                    <button
                      onClick={loadSoloChallenge}
                      className="btn-primary flex-1 py-3 text-sm font-bold"
                    >
                      Play Next Challenge
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSelectedRoomId(null);
                      setPhase("lobby");
                      setChallenge(null);
                    }}
                    className="btn-secondary flex-1 py-3 text-sm"
                  >
                    Lobby Dashboard
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
