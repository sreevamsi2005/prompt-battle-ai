"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { formatApiError } from "@/lib/error-stage";
import { computePoints } from "@/lib/points";

type Phase = "setup" | "waiting" | "playing" | "generating" | "results";
type VoiceStatus = "idle" | "recording" | "processing";

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

interface RoomStanding {
  playerName: string;
  score: number;
  points: number;
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
      <motion.p key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="text-sm font-mono text-zinc-300">
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
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-zinc-700 bg-black">
      <video ref={ref} src={src} muted playsInline loop preload="auto" className="h-full w-full object-cover" />
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
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [claiming, setClaiming] = useState(false);
  const [slotTakenBy, setSlotTakenBy] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pointsEarned, setPointsEarned] = useState<number | null>(null);
  const [standings, setStandings] = useState<RoomStanding[]>([]);
  const [replayRequested, setReplayRequested] = useState(false);
  const [goingGlobal, setGoingGlobal] = useState(false);

  const router = useRouter();

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const prevChallengeId = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceFinalRef = useRef<string>("");
  const deviceIdRef = useRef<string>("");
  const pollCtxRef = useRef<{ score: ScoreResult; points: number; playerName: string; roomId: string; prompt: string } | null>(null);

  // Generate a stable device ID per browser tab
  useEffect(() => {
    const key = `deviceId_slot_${slotNum}`;
    let id = sessionStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
    deviceIdRef.current = id;
  }, [slotNum]);

  // Heartbeat to keep slot alive (every 5s after joining)
  useEffect(() => {
    if (phase === "setup") return;
    const beat = async () => {
      await fetch("/api/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", slotNum, deviceId: deviceIdRef.current }),
      });
    };
    beat();
    const t = setInterval(beat, 5000);
    return () => clearInterval(t);
  }, [phase, slotNum]);

  // Release slot when tab closes or component unmounts
  useEffect(() => {
    const release = () => {
      const body = new Blob([JSON.stringify({ action: "release", slotNum, deviceId: deviceIdRef.current })], { type: "application/json" });
      navigator.sendBeacon("/api/slots", body);
    };
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("beforeunload", release);
      if (phase !== "setup") release();
    };
  }, [phase, slotNum]);

  // Poll for active room + challenge
  useEffect(() => {
    if (phase === "setup" || phase === "generating") return;
    const poll = async () => {
      try {
        const res = await fetch("/api/rooms");
        if (!res.ok) return;
        const rooms: RoomInfo[] = await res.json();
        const validRoom = rooms
          .filter(r => r.maxUsers >= slotNum)
          .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
        setRoom(validRoom);
        if (!validRoom || !validRoom.activeChallengeId || !validRoom.challengeDetails) {
          if (phase === "playing") setPhase("waiting");
          return;
        }
        if (validRoom.activeChallengeId !== prevChallengeId.current) {
          prevChallengeId.current = validRoom.activeChallengeId;
          setPrompt("");
          setUserVideo(null);
          setResult(null);
          setPointsEarned(null);
          setReplayRequested(false);
          setError(null);
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

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    setClaiming(true);
    setSlotTakenBy(null);
    setError(null);
    try {
      const res = await fetch("/api/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", slotNum, deviceId: deviceIdRef.current, playerName: playerName.trim() }),
      });
      const data = await res.json();

      // Storage/service error — do NOT let them in, or two devices could share a slot.
      if (!res.ok) {
        setError(data.error ?? "Could not reach the slot service. Try again.");
        return;
      }
      // Slot already held by someone else.
      if (!data.ok) {
        setSlotTakenBy(data.takenBy ?? "another player");
        return;
      }
      setPhase("waiting");
    } catch {
      // Network failure reaching our own API — block rather than risk a double-claim.
      setError("Network error verifying the slot. Check your connection and try again.");
    } finally {
      setClaiming(false);
    }
  };

  // Poll for video while in "generating" phase
  useEffect(() => {
    if (phase !== "generating" || !requestId) return;
    let cancelled = false;

    const finish = async (videoUrl: string | null) => {
      if (cancelled || !pollCtxRef.current) return;
      const { score, points, playerName: name, roomId } = pollCtxRef.current;
      try {
        await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "room", playerName: name, similarity: score.score, points, roomId }),
        });
      } catch {}
      if (videoUrl) setUserVideo({ videoUrl });
      setResult(score);
      setPointsEarned(points);
      setRequestId(null);
      setPhase("results");
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/generate-poll?requestId=${requestId}`);
        const data = await res.json();
        if (data.status === "COMPLETED") {
          await finish(data.videoUrl);
        } else if (data.status === "FAILED" || data.error) {
          setError(formatApiError(data, "Video generation failed."));
          await finish(null);
        }
        // IN_QUEUE / IN_PROGRESS → keep polling
      } catch {}
    };

    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, phase]);

  // While viewing results, keep roommate standings fresh.
  useEffect(() => {
    if (phase !== "results" || !room?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/leaderboard?roomId=${room.id}`);
        if (!res.ok) return;
        const data: RoomStanding[] = await res.json();
        if (!cancelled) setStandings(data);
      } catch {}
    };
    load();
    const t = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [phase, room?.id]);

  // Ask the admin for the next challenge.
  const requestNextChallenge = async () => {
    if (!room?.id || replayRequested) return;
    setReplayRequested(true);
    try {
      await fetch("/api/rooms/replay-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, playerName: playerName.trim() || `Player ${slotNum}` }),
      });
    } catch {
      setReplayRequested(false);
    }
  };

  // Publish this round's points to the global leaderboard, then open it.
  const goToGlobalLeaderboard = async () => {
    if (goingGlobal) return;
    setGoingGlobal(true);
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "global", playerName: playerName.trim() || `Player ${slotNum}`, points: pointsEarned ?? 0 }),
      });
    } catch {}
    router.push("/leaderboard");
  };

  const handleSubmit = async () => {
    if (!room?.challengeDetails || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const [genRes, scoreRes] = await Promise.all([
        fetch("/api/generate-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userPrompt: prompt.trim() }) }),
        fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: room.challengeDetails.challengeId, userPrompt: prompt.trim() }) }),
      ]);
      const genData = await genRes.json();
      const scoreData = (await scoreRes.json()) as ScoreResult;
      if (!scoreRes.ok) throw new Error(formatApiError(scoreData as any, "Scoring failed."));

      const name = playerName.trim() || `Player ${slotNum}`;
      const points = computePoints(room.challengeDetails.difficulty, scoreData.score);
      pollCtxRef.current = { score: scoreData, points, playerName: name, roomId: room.id, prompt: prompt.trim() };

      if (!genData.requestId) {
        // No FAL_KEY or submit failed — skip video, go straight to results
        if (genData.error && !genData.skipped) {
          setError(formatApiError(genData, "Video generation unavailable."));
        }
        await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "room", playerName: name, similarity: scoreData.score, points, roomId: room.id }),
        });
        setResult(scoreData);
        setPointsEarned(points);
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
    <div className="relative min-h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
      <div className="relative mx-auto w-full max-w-6xl px-4 py-6 flex-1 flex flex-col min-h-0">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3.5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight text-white uppercase">
              Player {slotNum} Station
            </h1>
            {room && (
              <span className="flex items-center gap-2 rounded bg-[#0066FF]/10 border border-[#0066FF]/30 px-3 py-1 text-xs text-[#0066FF] font-mono font-semibold">
                <span className="h-2 w-2 rounded-full bg-[#0066FF] animate-pulse" />
                {room.name}
              </span>
            )}
            {room?.challengeDetails && phase === "playing" && (
              <span className={`rounded px-2.5 py-1 text-xs font-bold uppercase font-mono border ${DIFFICULTY_STYLE[room.challengeDetails.difficulty]}`}>
                {room.challengeDetails.difficulty}
              </span>
            )}
          </div>
          {phase !== "setup" && playerName && (
            <div className="flex items-center gap-3 rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5">
              <span className="text-xs text-zinc-500 font-mono">Player:</span>
              <span className="text-xs font-bold text-white font-mono">{playerName}</span>
            </div>
          )}
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-h-0">
          <AnimatePresence mode="wait">

            {/* SETUP */}
            {phase === "setup" && (
              <motion.div key="setup" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex-1 flex items-center justify-center">
                <div className="graphite-card p-8 w-full max-w-md">
                  <p className="text-xs uppercase font-bold text-[#0066FF] font-mono tracking-wider mb-1">Booth Session</p>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Player {slotNum}</h2>
                  <p className="mt-2 text-sm text-zinc-400 leading-relaxed">Enter your name and wait for the admin to start the challenge round.</p>
                  <form onSubmit={handleStart} className="mt-6 space-y-4">
                    <div>
                      <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">Your Name</label>
                      <input type="text" value={playerName} onChange={e => { setPlayerName(e.target.value); setSlotTakenBy(null); }} placeholder="e.g. CyberRider" maxLength={18} autoFocus className="input-field" />
                    </div>
                    {slotTakenBy && (
                      <div className="rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400 font-semibold text-center">
                        Slot {slotNum} is already taken by <span className="text-rose-300">{slotTakenBy}</span>.<br />
                        <span className="text-xs font-normal text-rose-500/80 mt-1 block">Ask them to leave or use a different slot.</span>
                      </div>
                    )}
                    {error && !slotTakenBy && (
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400 font-semibold text-center">
                        {error}
                      </div>
                    )}
                    <button type="submit" disabled={!playerName.trim() || claiming} className="btn-primary w-full py-3 text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2">
                      {claiming ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" /></svg>
                          Checking slot…
                        </>
                      ) : "Join Session"}
                    </button>
                  </form>
                </div>
              </motion.div>
            )}

            {/* WAITING */}
            {phase === "waiting" && (
              <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center text-center py-20">
                {!room ? (
                  <>
                    <div className="h-10 w-10 rounded-full border-2 border-zinc-700 border-t-[#0066FF] animate-spin mb-5" />
                    <p className="text-sm font-bold text-white font-mono uppercase tracking-wider">No Active Room</p>
                    <p className="text-xs text-zinc-500 mt-2 max-w-xs leading-relaxed">Ask the admin to create a room with at least {slotNum} player slot{slotNum > 1 ? "s" : ""}.</p>
                  </>
                ) : (
                  <>
                    <div className="h-10 w-10 rounded-full border border-dashed border-[#0066FF] animate-spin mb-5" />
                    <p className="text-sm font-bold text-white font-mono uppercase tracking-wider">Waiting for Challenge</p>
                    <p className="text-xs text-zinc-500 mt-2 max-w-xs leading-relaxed">
                      Connected to <span className="text-zinc-300 font-semibold">{room.name}</span>.<br />The admin is selecting the challenge video…
                    </p>
                  </>
                )}
              </motion.div>
            )}

            {/* PLAYING — side-by-side layout */}
            {phase === "playing" && room?.challengeDetails && (
              <motion.div key="playing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-4 flex-1 min-h-0 lg:grid-cols-[1fr_420px]">

                {/* LEFT: Video */}
                <div className="relative min-h-[280px] lg:min-h-0 flex-1">
                  <ChallengeVideo src={room.challengeDetails.videoUrl} />
                </div>

                {/* RIGHT: Prompt panel */}
                <div className="flex flex-col gap-4 min-w-0 justify-between">

                  {/* Instruction */}
                  <div className="graphite-card p-4">
                    <h3 className="text-sm font-bold text-white uppercase tracking-tight">Decryption Guidance</h3>
                    <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-zinc-400">
                      Guess the original words. Aim for details regarding the{" "}
                      <span className="text-[#0066FF] font-semibold">subject, environment background, illumination, camera lens, speed, and cinematic aesthetic</span>.
                    </p>
                  </div>

                  {/* Textarea with voice input */}
                  <div className="graphite-card flex-1 flex flex-col min-h-[160px] overflow-hidden">
                    <textarea
                      ref={promptRef}
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder={voiceStatus === "recording" ? "Listening... speak now" : "Enter prompt description..."}
                      maxLength={1000}
                      className={`flex-1 resize-none bg-transparent p-4 text-xs sm:text-sm leading-relaxed text-white outline-none ${voiceStatus === "recording" ? "placeholder:text-[#0066FF]/60 placeholder:animate-pulse" : "placeholder:text-zinc-700"}`}
                    />
                    <div className="flex items-center justify-between border-t border-zinc-900 px-4 py-2.5 bg-black/60">
                      <span className="text-xs text-zinc-500 font-mono">{prompt.length}/1000 chars</span>
                      <div className="flex items-center gap-3">
                        {/* Voice button */}
                        <button
                          type="button"
                          onClick={voiceStatus === "recording" ? stopVoice : startVoice}
                          disabled={voiceStatus === "processing"}
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

                  <button onClick={handleSubmit} disabled={!prompt.trim() || submitting} className="btn-primary w-full py-3 text-sm font-bold uppercase tracking-wider">
                    Submit &amp; Render Video
                  </button>
                </div>
              </motion.div>
            )}

            {/* GENERATING */}
            {phase === "generating" && (
              <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center py-12">
                <div className="relative h-20 w-20 mb-6">
                  <div className="absolute inset-0 rounded-full border border-dashed border-[#0066FF]/30 animate-spin" style={{ animationDuration: "8s" }} />
                  <div className="absolute inset-2.5 rounded-full border border-t-[#0066FF] border-r-transparent border-b-transparent border-l-[#0066FF] animate-spin" style={{ animationDuration: "1.5s" }} />
                </div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono mb-2">Rendering Your Video</h2>
                <SpinMsg msgs={GEN_MSGS} />
                <div className="mt-8 w-full max-w-md graphite-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#0066FF] font-mono mb-2">Your Prompt</p>
                  <p className="text-sm leading-relaxed text-zinc-300 font-mono italic max-h-[100px] overflow-y-auto">"{prompt}"</p>
                </div>
              </motion.div>
            )}

            {/* RESULTS */}
            {phase === "results" && result && room?.challengeDetails && result && (
              <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col gap-4 overflow-y-auto">
                {/* Generation error notice */}
                {error && !userVideo && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400 font-semibold text-center">
                    {error} — your score is still recorded.
                  </div>
                )}
                {/* Score */}
                <div className="graphite-card p-5 flex items-center gap-5">
                  <div className="relative flex-shrink-0 h-20 w-20 flex items-center justify-center">
                    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="#27272a" strokeWidth="2.5" />
                      <motion.circle cx="18" cy="18" r="16" fill="none" stroke="#0066FF" strokeWidth="2.5" strokeLinecap="round" initial={{ strokeDasharray: "0 100" }} animate={{ strokeDasharray: `${result.score} 100` }} transition={{ duration: 1.2, ease: "easeOut" }} />
                    </svg>
                    <span className="absolute text-xl font-bold tracking-tight text-white font-mono">{result.score}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">{result.score >= 80 ? "Superb Alignment" : result.score >= 50 ? "Moderate Resonance" : "Semantic Deviation"}</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">{result.feedback}</p>
                  </div>
                  {pointsEarned !== null && (
                    <div className="flex-shrink-0 text-center rounded-lg border border-[#0066FF]/30 bg-[#0066FF]/10 px-4 py-3">
                      <p className="text-2xl font-bold text-[#0066FF] font-mono leading-none">+{pointsEarned}</p>
                      <p className="mt-1 text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-mono">points</p>
                    </div>
                  )}
                </div>

                {/* Side-by-side videos */}
                <div className={`grid gap-3 ${userVideo ? "grid-cols-2" : "grid-cols-1 max-w-lg"}`}>
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

                {/* Roommate standings */}
                <div className="graphite-card p-4">
                  <p className="text-xs uppercase font-bold tracking-wider text-[#0066FF] font-mono border-b border-zinc-900 pb-2 mb-2.5 flex items-center justify-between">
                    <span>Room Standings{room?.name ? ` · ${room.name}` : ""}</span>
                    <span className="text-[10px] font-normal text-zinc-500 normal-case">Live</span>
                  </p>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                    {standings.length > 0 ? (
                      standings.map((s, idx) => {
                        const isMe = s.playerName.toLowerCase() === (playerName.trim() || `Player ${slotNum}`).toLowerCase();
                        return (
                          <div key={s.playerName + idx} className={`flex items-center justify-between rounded px-3 py-2 text-xs sm:text-sm border ${isMe ? "bg-[#0066FF]/15 border-[#0066FF]/35 text-white font-bold" : "bg-black/40 border-zinc-900 text-zinc-300"}`}>
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-5 text-center font-mono font-bold text-zinc-600">{idx + 1}</span>
                              <span className="truncate">{s.playerName}</span>
                            </div>
                            <span className="font-mono text-[#0066FF] font-bold flex-shrink-0">{s.points} pts</span>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-center py-6 text-xs text-zinc-600 font-mono">No scores recorded yet.</p>
                    )}
                  </div>
                </div>

                {/* Next-round actions */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={requestNextChallenge}
                    disabled={replayRequested}
                    className="btn-secondary py-3 text-sm font-bold uppercase tracking-wider disabled:opacity-60"
                  >
                    {replayRequested ? "Request Sent ✓ — Waiting for Admin" : "Request Next Challenge"}
                  </button>
                  <button
                    onClick={goToGlobalLeaderboard}
                    disabled={goingGlobal}
                    className="btn-primary py-3 text-sm font-bold uppercase tracking-wider"
                  >
                    {goingGlobal ? "Publishing…" : "Go to Global Leaderboard →"}
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
