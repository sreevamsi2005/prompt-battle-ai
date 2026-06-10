"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

type Phase = "setup" | "waiting" | "playing" | "generating" | "results";

interface ChallengeDetails {
  challengeId: string;
  videoUrl: string;
  difficulty: "easy" | "medium" | "hard";
  theme: string;
}

interface RoomInfo {
  id: string;
  name: string;
  maxUsers: number;
  createdAt: number;
  activeChallengeId: string | null;
  challengeDetails: ChallengeDetails | null;
}

interface ScoreResult {
  score: number;
  feedback: string;
}

interface UserVideo {
  videoUrl: string;
}

const DIFFICULTY_STYLE = {
  easy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  hard: "text-rose-400 bg-rose-500/10 border-rose-500/30",
};

const GEN_MSGS = [
  "Synthesizing neural assets…",
  "Rendering cinematic sequences…",
  "Assembling temporal dynamics…",
  "Evaluating frame interpolation…",
  "Finalizing high-fidelity output…",
];

function SpinMsg({ msgs }: { msgs: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % msgs.length), 2500);
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
    <div className="relative w-full rounded-lg overflow-hidden border border-zinc-700 bg-black aspect-video">
      <video ref={ref} src={src} muted playsInline loop preload="auto" className="w-full h-full object-cover" />
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded border border-zinc-700 bg-black/90 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0066FF] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0066FF]" />
        </span>
        LIVE FEED
      </div>
    </div>
  );
}

export default function PlayerSlotPage() {
  const params = useParams();
  const slotNum = parseInt(params.slot as string, 10);
  const isValidSlot = !isNaN(slotNum) && slotNum >= 1 && slotNum <= 20;

  const [phase, setPhase] = useState<Phase>("setup");
  const [playerName, setPlayerName] = useState("");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [prompt, setPrompt] = useState("");
  const [userVideo, setUserVideo] = useState<UserVideo | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const prevChallengeId = useRef<string | null>(null);

  // Poll for active room + challenge
  useEffect(() => {
    if (phase === "setup" || phase === "generating") return;

    const poll = async () => {
      try {
        const res = await fetch("/api/rooms");
        if (!res.ok) return;
        const rooms: RoomInfo[] = await res.json();

        // Most recently created room where this slot number is valid
        const validRoom = rooms
          .filter(r => r.maxUsers >= slotNum)
          .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

        setRoom(validRoom);

        if (!validRoom || !validRoom.activeChallengeId || !validRoom.challengeDetails) {
          if (phase === "playing") setPhase("waiting");
          return;
        }

        // New challenge assigned — reset state
        if (validRoom.activeChallengeId !== prevChallengeId.current) {
          prevChallengeId.current = validRoom.activeChallengeId;
          setPrompt("");
          setUserVideo(null);
          setResult(null);
          setPhase("playing");
        }
      } catch (e) {
        console.error("Room poll error:", e);
      }
    };

    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [phase, slotNum]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    setPhase("waiting");
  };

  const handleSubmit = async () => {
    if (!room?.challengeDetails || !prompt.trim()) return;
    setSubmitting(true);
    setPhase("generating");
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
          body: JSON.stringify({
            challengeId: room.challengeDetails.challengeId,
            userPrompt: prompt.trim(),
          }),
        }),
      ]);

      const genData = await genRes.json();
      const scoreData = (await scoreRes.json()) as ScoreResult;

      if (!genRes.ok || genData.error) throw new Error(genData.error ?? "Generation failed");

      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: playerName.trim() || `Player ${slotNum}`,
          score: scoreData.score,
          roomId: room.id,
        }),
      });

      setUserVideo(genData);
      setResult(scoreData);
      setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("playing");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isValidSlot) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="graphite-card p-8 text-center max-w-sm">
          <p className="text-white font-bold text-lg">Invalid Slot</p>
          <p className="text-zinc-400 text-sm mt-2">Use /play/1, /play/2, /play/3, etc.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 flex-1 flex flex-col">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="rounded border border-[#0066FF]/30 bg-[#0066FF]/10 px-3 py-1 text-xs font-bold text-[#0066FF] font-mono uppercase tracking-wider">
              Player {slotNum}
            </span>
            {room && (
              <span className="text-xs text-zinc-500 font-mono">{room.name}</span>
            )}
            {room?.challengeDetails && phase === "playing" && (
              <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase font-mono border ${DIFFICULTY_STYLE[room.challengeDetails.difficulty]}`}>
                {room.challengeDetails.difficulty}
              </span>
            )}
          </div>
          {phase !== "setup" && playerName && (
            <span className="text-xs font-mono text-zinc-400 border border-zinc-800 bg-zinc-950 rounded px-3 py-1">
              {playerName}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">

          {/* SETUP */}
          {phase === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center"
            >
              <div className="graphite-card p-8 w-full max-w-md">
                <p className="text-xs uppercase font-bold text-[#0066FF] font-mono tracking-wider mb-1">Booth Session</p>
                <h1 className="text-2xl font-bold text-white tracking-tight">Player {slotNum}</h1>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                  Enter your name and wait for the admin to start the challenge round.
                </p>
                <form onSubmit={handleStart} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">Your Name</label>
                    <input
                      type="text"
                      value={playerName}
                      onChange={e => setPlayerName(e.target.value)}
                      placeholder="e.g. CyberRider"
                      maxLength={18}
                      autoFocus
                      className="input-field"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!playerName.trim()}
                    className="btn-primary w-full py-3 text-sm font-bold uppercase tracking-wider"
                  >
                    Join Session →
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {/* WAITING */}
          {phase === "waiting" && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center py-20"
            >
              {!room ? (
                <>
                  <div className="h-10 w-10 rounded-full border-2 border-zinc-700 border-t-[#0066FF] animate-spin mb-5" />
                  <p className="text-sm font-bold text-white font-mono uppercase tracking-wider">No Active Room</p>
                  <p className="text-xs text-zinc-500 mt-2 max-w-xs leading-relaxed">
                    Ask the admin to create a room with at least {slotNum} player slot{slotNum > 1 ? "s" : ""}.
                  </p>
                </>
              ) : (
                <>
                  <div className="h-10 w-10 rounded-full border border-dashed border-[#0066FF] animate-spin mb-5" />
                  <p className="text-sm font-bold text-white font-mono uppercase tracking-wider">Waiting for Challenge</p>
                  <p className="text-xs text-zinc-500 mt-2 max-w-xs leading-relaxed">
                    Connected to <span className="text-zinc-300 font-semibold">{room.name}</span>.<br />
                    The admin is selecting the challenge video…
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* PLAYING */}
          {phase === "playing" && room?.challengeDetails && (
            <motion.div
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col gap-4"
            >
              <ChallengeVideo src={room.challengeDetails.videoUrl} />

              <div className="graphite-card p-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-tight">Your Mission</h3>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  Reverse-engineer the original prompt. Describe the{" "}
                  <span className="text-[#0066FF] font-semibold">subject, environment, lighting, camera angle, mood, and cinematic style</span>.
                </p>
              </div>

              <div className="graphite-card flex-1 flex flex-col min-h-[160px] overflow-hidden">
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe the scene you see…"
                  maxLength={1000}
                  className="flex-1 resize-none bg-transparent p-4 text-sm leading-relaxed text-white placeholder:text-zinc-700 outline-none"
                />
                <div className="flex items-center justify-between border-t border-zinc-900 px-4 py-2.5 bg-black/60">
                  <span className="text-xs text-zinc-500 font-mono">{prompt.length}/1000</span>
                  <button
                    onClick={() => { setPrompt(""); promptRef.current?.focus(); }}
                    disabled={!prompt}
                    className="text-xs font-semibold text-zinc-500 hover:text-white transition disabled:opacity-0"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-rose-400 text-center font-semibold">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || submitting}
                className="btn-primary w-full py-3 text-sm font-bold uppercase tracking-wider"
              >
                Submit &amp; Render Video →
              </button>
            </motion.div>
          )}

          {/* GENERATING */}
          {phase === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center py-12"
            >
              <div className="relative h-20 w-20 mb-6">
                <div className="absolute inset-0 rounded-full border border-dashed border-[#0066FF]/30 animate-spin" style={{ animationDuration: "8s" }} />
                <div className="absolute inset-2.5 rounded-full border border-t-[#0066FF] border-r-transparent border-b-transparent border-l-[#0066FF] animate-spin" style={{ animationDuration: "1.5s" }} />
              </div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono mb-2">Rendering Your Video</h2>
              <SpinMsg msgs={GEN_MSGS} />
              <div className="mt-8 w-full graphite-card p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#0066FF] font-mono mb-2">Your Prompt</p>
                <p className="text-sm leading-relaxed text-zinc-300 font-mono italic max-h-[100px] overflow-y-auto">"{prompt}"</p>
              </div>
            </motion.div>
          )}

          {/* RESULTS */}
          {phase === "results" && result && room?.challengeDetails && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col gap-4 overflow-y-auto"
            >
              {/* Score ring */}
              <div className="graphite-card p-5 flex items-center gap-5">
                <div className="relative flex-shrink-0 h-20 w-20 flex items-center justify-center">
                  <svg className="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#27272a" strokeWidth="2.5" />
                    <motion.circle
                      cx="18" cy="18" r="16"
                      fill="none" stroke="#0066FF" strokeWidth="2.5" strokeLinecap="round"
                      initial={{ strokeDasharray: "0 100" }}
                      animate={{ strokeDasharray: `${result.score} 100` }}
                      transition={{ duration: 1.2, ease: "easeOut" }}
                    />
                  </svg>
                  <span className="absolute text-xl font-bold tracking-tight text-white font-mono">{result.score}</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    {result.score >= 80 ? "Superb Alignment" : result.score >= 50 ? "Moderate Resonance" : "Semantic Deviation"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{result.feedback}</p>
                </div>
              </div>

              {/* Side-by-side videos */}
              <div className="grid grid-cols-2 gap-3">
                <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 bg-black">
                  <video src={room.challengeDetails.videoUrl} muted playsInline loop autoPlay className="w-full h-full object-cover" />
                  <span className="absolute top-2 left-2 rounded border border-zinc-700 bg-black/90 px-2 py-0.5 text-[10px] font-bold text-zinc-300 uppercase">Original</span>
                </div>
                {userVideo && (
                  <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-700 bg-black">
                    <video src={userVideo.videoUrl} muted playsInline loop autoPlay className="w-full h-full object-cover" />
                    <span className="absolute top-2 left-2 rounded border border-zinc-700 bg-black/90 px-2 py-0.5 text-[10px] font-bold text-[#0066FF] uppercase">Yours</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center border border-dashed border-zinc-800 rounded p-4">
                <span className="h-2 w-2 bg-[#0066FF] rounded-full animate-ping mr-2 flex-shrink-0" />
                <span className="text-xs text-zinc-400 font-mono">Waiting for admin to start next round…</span>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
