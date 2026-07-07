"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { getPlayerName, setPlayerName } from "@/lib/leaderboard";
import { formatApiError } from "@/lib/error-stage";
import { evaluationRemark, computeFinalScore } from "@/lib/scoring";
import type { ScoreResult } from "@/lib/types";

/* ─── Types ─────────────────────────────────────────────────────────────── */
type Phase = "lobby" | "loading" | "waiting" | "playing" | "generating" | "results";

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
  slots: (string | null)[];  // index = slot (0-based), value = playerName or null
}

interface RoomPlayerStatus {
  playerName: string;
  hasSubmitted: boolean;
  score: number | null;
  finalScore: number | null;
}

interface RoomState {
  id: string;
  name: string;
  maxUsers: number;
  activeChallengeId: string | null;
  battleStartedAt: number | null;
  resetAt: number | null;
  challengeDetails: Challenge | null;
  players: RoomPlayerStatus[];
  submissions: { playerName: string; score: number; videoScore?: number; compositeScore?: number; timeTakenToPrompt: number; timestamp: number }[];
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

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

// A player who enters the battle more than this long after it started is treated
// as a late joiner (e.g. slow connection) and gets their own fresh 60s countdown
// so connection lag never costs them their turn or their score. Players who were
// present when the host started stay on the synchronized shared clock.
const LATE_JOIN_GRACE_MS = 5000;

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

/* ─── Challenge Timer ────────────────────────────────────────────────────── */
function ChallengeTimer({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null;
  const danger = seconds > 0 && seconds <= 10;
  const expired = seconds === 0;

  const accent = danger || expired;

  return (
    <motion.div
      animate={danger ? { x: [0, -2, 2, -2, 2, 0] } : { x: 0 }}
      transition={danger ? { duration: 0.45, repeat: Infinity, repeatDelay: 0.3 } : { duration: 0.2 }}
      className={`relative flex items-center gap-2.5 rounded-lg border px-3 py-1.5 select-none transition-colors ${
        accent ? "border-rose-500/60 bg-rose-500/10" : "border-zinc-700 bg-zinc-900/80"
      }`}
    >
      {danger && (
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
        </span>
      )}
      <svg className={`h-5 w-5 flex-shrink-0 ${accent ? "text-rose-400" : "text-zinc-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className={`text-[9px] font-mono font-bold uppercase tracking-[0.15em] mb-1 ${accent ? "text-rose-400/90" : "text-zinc-500"}`}>
          {expired ? "Time's Up" : "Time Left"}
        </span>
        <motion.span
          key={seconds}
          initial={danger ? { scale: 1.25, opacity: 0.6 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25 }}
          className={`font-mono font-extrabold tabular-nums leading-none text-2xl ${accent ? "text-rose-100" : "text-zinc-50"}`}
        >
          {seconds}<span className="text-sm font-bold opacity-50 ml-px">s</span>
        </motion.span>
      </div>
    </motion.div>
  );
}

/* ─── Round resolution (standings gating) ────────────────────────────────
 * Standings must only be shown once EVERY present player's final (composite)
 * score has resolved — ranking as soon as one player finishes previously made
 * the "winner" flicker as later players caught up. Two escape hatches stop
 * this from hanging forever: a submission whose video never resolves falls
 * back to its text score after ANALYSIS_TIMEOUT_MS (mirrors the admin panel),
 * and a player who never actually submits a prompt stops blocking everyone
 * else after NO_SUBMIT_GRACE_MS. */
const ANALYSIS_TIMEOUT_MS = 180_000;
const NO_SUBMIT_GRACE_MS = 90_000;

interface RoundEntry {
  playerName: string;
  finalScore: number;
  timeTakenToPrompt: number;
}

function evaluateRound(roomState: RoomState): {
  resolved: boolean;
  finishedCount: number;
  totalCount: number;
  ranked: RoundEntry[];
} {
  const players = roomState.players ?? [];
  const subs = roomState.submissions ?? [];
  const now = Date.now();

  const finalOf = (s: { compositeScore?: number; score: number; timestamp: number }) => {
    if (s.compositeScore != null) return s.compositeScore;
    if (now - s.timestamp > ANALYSIS_TIMEOUT_MS) return s.score;
    return null;
  };

  let resolved = subs.length > 0;
  for (const p of players) {
    const sub = subs.find((s) => s.playerName.toLowerCase() === p.playerName.toLowerCase());
    if (!sub) {
      if (!roomState.battleStartedAt || now - roomState.battleStartedAt < NO_SUBMIT_GRACE_MS) resolved = false;
      continue;
    }
    if (finalOf(sub) == null) resolved = false;
  }

  const ranked = subs
    .map((s) => ({ playerName: s.playerName, finalScore: finalOf(s), timeTakenToPrompt: s.timeTakenToPrompt }))
    .filter((s): s is RoundEntry => s.finalScore != null)
    .sort((a, b) => (b.finalScore - a.finalScore) || (a.timeTakenToPrompt - b.timeTakenToPrompt));

  return { resolved, finishedCount: ranked.length, totalCount: Math.max(players.length, subs.length), ranked };
}

/* ─── Winner celebration burst ───────────────────────────────────────────── */
function ConfettiBurst({ triggerKey }: { triggerKey: number }) {
  const [particles, setParticles] = useState<
    { id: number; x: number; y: number; rotate: number; color: string; w: number; h: number; delay: number }[]
  >([]);

  useEffect(() => {
    if (triggerKey === 0) return;
    const colors = ["#FBBF24", "#0066FF", "#FB7185", "#34D399", "#F5F5F5", "#A78BFA"];
    const next = Array.from({ length: 90 }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 140 + Math.random() * 340;
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance - 90,
        rotate: Math.random() * 720 - 360,
        color: colors[i % colors.length],
        w: 5 + Math.random() * 6,
        h: 10 + Math.random() * 9,
        delay: Math.random() * 0.2,
      };
    });
    setParticles(next);
    const t = setTimeout(() => setParticles([]), 2600);
    return () => clearTimeout(t);
  }, [triggerKey]);

  if (particles.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-start justify-center overflow-hidden">
      <div className="relative top-[28%]">
        {particles.map((p) => (
          <motion.span
            key={p.id}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: p.x, y: p.y, opacity: 0, rotate: p.rotate }}
            transition={{ duration: 1.8, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: "absolute", width: p.w, height: p.h, backgroundColor: p.color, borderRadius: 2 }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Personal final-score circle (top-left) ─────────────────────────────── */
function MyScoreCard({
  finalScore, headline, subtext, amWinner,
}: { finalScore: number | null; headline: string; subtext: string; amWinner: boolean }) {
  return (
    <div
      className={`graphite-card p-5 flex flex-col items-center text-center gap-2.5 ${
        amWinner ? "border-yellow-400/50 shadow-[0_0_34px_-10px_rgba(250,204,21,0.5)]" : ""
      }`}
    >
      {amWinner && (
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="text-3xl leading-none"
        >
          🏆
        </motion.div>
      )}
      <div className={finalScore == null ? "relative h-28 w-40 flex flex-col items-center justify-center" : "relative h-32 w-32 flex items-center justify-center"}>
        {finalScore == null ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/animations/sandy-loading.svg" alt="" className="h-24 w-40 object-contain" />
            <motion.span
              className="text-[9px] uppercase tracking-wider text-[#0066FF] font-mono font-bold mt-0.5"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              analyzing…
            </motion.span>
          </>
        ) : (
          <>
            <svg className="h-32 w-32 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#27272a" strokeWidth="2.5" />
              <motion.circle
                cx="18" cy="18" r="16" fill="none"
                stroke={amWinner ? "#FBBF24" : "#0066FF"}
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={{ strokeDasharray: "0 100" }}
                animate={{ strokeDasharray: `${finalScore} 100` }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className={`text-4xl font-extrabold font-mono leading-none ${amWinner ? "text-yellow-300" : "text-white"}`}
              >
                {finalScore}
              </motion.span>
              <span className={`text-[9px] uppercase tracking-wider font-mono mt-1 ${amWinner ? "text-yellow-400" : "text-[#0066FF]"}`}>
                Final Score
              </span>
            </div>
          </>
        )}
      </div>
      <div>
        <p className="text-sm sm:text-base font-bold text-white leading-snug">{headline}</p>
        <p className="mt-1 text-[11px] text-zinc-500 font-mono">{subtext}</p>
      </div>
    </div>
  );
}

/* ─── Battle standings (top-right) ───────────────────────────────────────── */
// Rank-specific "riser" material: a light top edge fading through a base tone
// into a darker shadowed base — this gradient is what makes the block read as
// an extruded 3D pedestal rather than a flat rectangle.
const PODIUM_PALETTE = [
  { top: "#FFF6D2", base: "#F5C518", mid: "#D9A70B", dark: "#7A5900", ring: "border-yellow-300/60", glow: "shadow-[0_20px_44px_-14px_rgba(250,204,21,0.6)]", text: "text-yellow-100" },
  { top: "#F4F6F8", base: "#C7CDD6", mid: "#9AA2AD", dark: "#4B525C", ring: "border-zinc-300/50", glow: "shadow-[0_16px_34px_-14px_rgba(200,205,214,0.4)]", text: "text-zinc-50" },
  { top: "#F3D3AE", base: "#D08A4C", mid: "#B06B33", dark: "#5E3216", ring: "border-orange-300/50", glow: "shadow-[0_16px_34px_-14px_rgba(208,138,76,0.45)]", text: "text-orange-100" },
];
const PODIUM_HEIGHTS = [148, 106, 82]; // 1st, 2nd, 3rd — tallest center riser reads as top rank

function PodiumBlock({ entry, rank, isMe }: { entry: RoundEntry; rank: number; isMe: boolean }) {
  const p = PODIUM_PALETTE[rank];
  const isWinner = rank === 0;

  return (
    <div className="flex flex-col items-center flex-1 min-w-0 max-w-[130px]">
      {/* Trophy on the winner, medal glyph for 2nd/3rd */}
      <div className="h-9 flex items-end justify-center mb-1">
        {isWinner ? (
          <motion.span
            animate={{ y: [0, -5, 0], rotate: [-5, 5, -5] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="text-3xl drop-shadow-[0_6px_12px_rgba(250,204,21,0.65)]"
          >
            🏆
          </motion.span>
        ) : (
          <span className="text-lg opacity-85">{rank === 1 ? "🥈" : "🥉"}</span>
        )}
      </div>

      {/* Name — flips into place with an embossed 3D text treatment */}
      <div style={{ perspective: 500 }} className="max-w-full px-1">
        <motion.p
          initial={{ opacity: 0, rotateX: -85, y: 10 }}
          animate={{ opacity: 1, rotateX: 0, y: 0 }}
          transition={{ type: "spring", stiffness: 210, damping: 17, delay: rank * 0.12 }}
          style={{
            transformStyle: "preserve-3d",
            textShadow: isMe
              ? "1px 1px 0 rgba(0,70,200,0.6), 2px 2px 4px rgba(0,0,0,0.4)"
              : `1px 1px 0 ${p.mid}, 2px 2px 0 ${p.dark}, 3px 3px 5px rgba(0,0,0,0.45)`,
          }}
          className={`font-mono font-extrabold truncate text-center leading-tight ${isWinner ? "text-lg" : "text-sm"} ${isMe ? "text-[#4d94ff]" : p.text}`}
        >
          {entry.playerName}
        </motion.p>
      </div>
      {isMe && <span className="text-[9px] font-bold text-[#0066FF]/80 leading-none mt-0.5">(YOU)</span>}

      {/* Score */}
      <p className={`font-mono font-extrabold tabular-nums mt-1 mb-2 ${isWinner ? "text-2xl" : "text-lg"} ${p.text}`}>
        {entry.finalScore}
      </p>

      {/* The 3D riser — gradient face + glossy top cap + embossed rank numeral */}
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: PODIUM_HEIGHTS[rank], opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: rank * 0.12 }}
        className={`relative w-full rounded-t-lg border ${p.ring} ${p.glow} overflow-hidden`}
        style={{ background: `linear-gradient(180deg, ${p.top} 0%, ${p.base} 24%, ${p.mid} 68%, ${p.dark} 100%)` }}
      >
        {/* glossy top-edge highlight — sells the "looking at a raised surface" illusion */}
        <div className="absolute top-0 left-0 right-0 h-2.5" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0))" }} />
        {/* winner-only shine sweep for a premium/trophy-case feel */}
        {isWinner && (
          <motion.div
            className="absolute inset-y-0 w-1/3"
            style={{ background: "linear-gradient(115deg, transparent, rgba(255,255,255,0.4), transparent)" }}
            animate={{ x: ["-140%", "240%"] }}
            transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-black font-mono" style={{ color: "rgba(0,0,0,0.3)" }}>{rank + 1}</span>
        </div>
      </motion.div>
    </div>
  );
}

function StandingsCard({
  ranked, resolved, finishedCount, totalCount, myName,
}: { ranked: RoundEntry[]; resolved: boolean; finishedCount: number; totalCount: number; myName: string }) {
  return (
    <div className="graphite-card p-4 sm:p-5 flex flex-col min-h-[220px]">
      <div className="flex items-center justify-between border-b border-zinc-900 pb-2.5 mb-3">
        <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider font-mono">Final Standings</h3>
        {resolved ? (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono font-bold uppercase">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            All Scored
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] text-amber-400 font-mono font-bold uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            {finishedCount}/{totalCount} scored
          </span>
        )}
      </div>

      {!resolved ? (
        <div className="flex-1 flex flex-col items-center justify-center py-4 gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/animations/animation-spider.svg" alt="" className="h-24 w-24" />
          <p className="text-xs sm:text-sm text-zinc-400 font-mono text-center leading-relaxed">
            Waiting for every battle-mate to finish…
            <br />
            <span className="text-[10px] text-zinc-600">Standings lock in once all scores are final.</span>
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-end">
          {/* Podium — classic 2nd·1st·3rd arrangement, tallest riser center */}
          {(() => {
            const top3 = ranked.slice(0, 3);
            const order = top3.length >= 3 ? [1, 0, 2] : top3.length === 2 ? [1, 0] : [0];
            return (
              <div className="flex items-end justify-center gap-3 sm:gap-4 px-1">
                {order.map((rank) =>
                  top3[rank] ? (
                    <PodiumBlock
                      key={top3[rank].playerName}
                      entry={top3[rank]}
                      rank={rank}
                      isMe={top3[rank].playerName.toLowerCase() === myName.toLowerCase()}
                    />
                  ) : null
                )}
              </div>
            );
          })()}

          {/* 4th place and beyond — compact rows below the podium */}
          {ranked.length > 3 && (
            <div className="mt-4 space-y-1.5 border-t border-zinc-900 pt-3">
              {ranked.slice(3).map((entry, i) => {
                const rank = i + 3;
                const isMe = entry.playerName.toLowerCase() === myName.toLowerCase();
                return (
                  <div
                    key={entry.playerName}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                      isMe ? "border-[#0066FF]/40 bg-[#0066FF]/10" : "border-zinc-800 bg-zinc-900/40"
                    }`}
                  >
                    <span className="h-6 w-6 flex-shrink-0 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 text-xs font-mono font-bold">
                      #{rank + 1}
                    </span>
                    <span className={`flex-1 min-w-0 font-mono font-bold truncate ${isMe ? "text-[#0066FF]" : "text-zinc-200"}`}>
                      {entry.playerName}{isMe && " (you)"}
                    </span>
                    <span className="flex-shrink-0 font-mono font-extrabold tabular-nums text-zinc-200">{entry.finalScore}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Play page Component ───────────────────────────────────────────── */
export default function PlayPage() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [playerName, setPlayerNameState] = useState("");
  const [playerEmail, setPlayerEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  // Independent identity for the multiplayer card (kept separate from solo).
  const [mpName, setMpName] = useState("");
  const [mpEmail, setMpEmail] = useState("");
  const [mpEmailError, setMpEmailError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  
  // Room state
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  
  // Challenge & gameplay state
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  // Battle start timestamp (multiplayer) — null while waiting for players.
  const [battleStartedAt, setBattleStartedAt] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [userVideo, setUserVideo] = useState<UserVideo | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [videoScore, setVideoScore] = useState<number | null>(null);
  // True while the video-similarity score is being computed in the background
  // (results screen is already showing the generated video, score area loads).
  const [scoring, setScoring] = useState(false);
  // True when a solo submission scored ≤70 so no video was generated.
  const [videoGated, setVideoGated] = useState(false);

  // Highscore Lists

  const [loadingRooms, setLoadingRooms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  // One-line qualitative feedback from the video-similarity model.
  const [videoFeedback, setVideoFeedback] = useState<string | null>(null);
  const [goingGlobal, setGoingGlobal] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  // Fires the winner confetti burst exactly once per round.
  const [confettiBurstId, setConfettiBurstId] = useState(0);
  const celebratedRef = useRef(false);

  const router = useRouter();

  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "processing">("idle");

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const activeChallengeIdRef = useRef<string | null>(null);
  // Identifies the current round (challengeId + battleStartedAt) to detect new rounds.
  const roundKeyRef = useRef<string>("");
  // resetAt value seen when joining; if the room's resetAt later increases, the
  // admin reset the session and this device returns to the lobby. undefined =
  // not yet baselined (set on the first heartbeat after joining).
  const resetBaselineRef = useRef<number | null | undefined>(undefined);
  const challengeStartTimeRef = useRef<number | null>(null);
  // When this client entered the playing phase for the current round. On-time
  // players share the synchronized countdown (from battleStartedAt); late joiners
  // start their own fresh 60s from here so they can still submit and be scored.
  const playingEnteredAtRef = useRef<number | null>(null);
  // Guards the timer's auto-submit so it fires at most once per challenge.
  const autoSubmittedRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceFinalRef = useRef<string>("");
  // Holds score + context needed by the polling effect (avoids stale-closure deps)
  const pollCtxRef = useRef<{ score: ScoreResult; playerName: string; roomId: string | null; prompt: string; submissionTimestamp: number; challengeId: string; timeTakenToPrompt: number; email: string; videoTag: string; difficulty: "easy" | "medium" | "hard"; autoSubmitted: boolean } | null>(null);

  // Load player name on mount
  useEffect(() => {
    const saved = getPlayerName();
    if (saved) setPlayerNameState(saved);
  }, []);

  // Fetch available rooms. `silent` skips the spinner for background polls.
  const fetchRooms = async (silent = false) => {
    if (!silent) setLoadingRooms(true);
    try {
      const res = await fetch("/api/rooms");
      if (res.ok) {
        const data = await res.json();
        setRooms(data);
      }
    } catch (e) {
      console.error("Failed to load rooms:", e);
    }
    if (!silent) setLoadingRooms(false);
  };

  // While in the lobby, poll rooms every 3s so slot occupancy stays live.
  useEffect(() => {
    if (phase !== "lobby") return;
    fetchRooms();
    const t = setInterval(() => fetchRooms(true), 3000);
    return () => clearInterval(t);
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

          // Admin session reset → return this device to the general /play lobby.
          // The first beat after joining records the baseline; a later increase
          // means a reset happened while we were connected.
          const rAt = data.resetAt ?? null;
          if (resetBaselineRef.current === undefined) {
            resetBaselineRef.current = rAt;
          } else if (rAt != null && (resetBaselineRef.current === null || rAt > resetBaselineRef.current)) {
            resetBaselineRef.current = rAt;
            roundKeyRef.current = "";
            setSelectedRoomId(null);
            setChallenge(null);
            setPrompt("");
            setUserVideo(null);
            setResult(null);
            setVideoScore(null);
            setScoring(false);
            setVideoFeedback(null);
            setVideoGated(false);
            setRoomState(null);
            setPhase("lobby");
            celebratedRef.current = false;
            setConfettiBurstId(0);
            return;
          }

          setRoomState(data);
          setBattleStartedAt(data.battleStartedAt ?? null);

          // Extract this player's video score if analysis has completed
          const myName = playerName.trim().toLowerCase();
          const mine = data.submissions?.find(s => s.playerName.toLowerCase() === myName);
          if (mine?.videoScore != null) setVideoScore(mine.videoScore);

          // A "round" is one challenge + one battle start. When either changes,
          // it's a fresh round: reset state and route to waiting / playing.
          // A battle is playable for this client whenever a challenge is set and
          // the host has started it. We intentionally do NOT gate on the 60s
          // prompt window: a player who joins late (slow connection, joined
          // mid-round) must still be able to play and be scored. On-time players
          // share the synchronized countdown; late joiners get their own fresh
          // 60s (see the challenge-timer effect below).
          const started = data.battleStartedAt != null && !!data.challengeDetails;
          const roundKey = `${data.activeChallengeId ?? ""}:${data.battleStartedAt ?? ""}`;
          if (roundKey !== roundKeyRef.current) {
            roundKeyRef.current = roundKey;
            activeChallengeIdRef.current = data.activeChallengeId;
            setChallenge(data.challengeDetails ?? null);
            // Clear previous round entries
            setPrompt("");
            setUserVideo(null);
            setResult(null);
            setVideoScore(null);
            setScoring(false);
            setVideoFeedback(null);
            setVideoGated(false);
            celebratedRef.current = false;
            setConfettiBurstId(0);
            // Battle started + challenge ready → play; otherwise wait for players.
            if (started) playingEnteredAtRef.current = Date.now();
            setPhase(started ? "playing" : "waiting");
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

  // 60-second challenge timer. In multiplayer it counts from the shared
  // battleStartedAt so every player's clock is synchronized; solo counts from now.
  useEffect(() => {
    if (phase === "playing" && challenge) {
      // On-time players share the synchronized countdown from battleStartedAt.
      // A late joiner (slow connection / joined mid-round) entered the playing
      // phase well after the battle started — give them their own fresh 60s so
      // they can still prompt and be scored instead of seeing an expired timer.
      let start: number;
      if (selectedRoomId && battleStartedAt) {
        const enteredAt = playingEnteredAtRef.current ?? Date.now();
        const lateBy = enteredAt - battleStartedAt;
        start = lateBy > LATE_JOIN_GRACE_MS ? enteredAt : battleStartedAt;
      } else {
        start = Date.now();
      }
      challengeStartTimeRef.current = start;
      autoSubmittedRef.current = false;
      const tick = () => {
        const remaining = Math.max(0, 60 - Math.floor((Date.now() - start) / 1000));
        setTimeLeft(remaining);
        return remaining;
      };
      tick();
      const t = setInterval(() => { if (tick() <= 0) clearInterval(t); }, 1000);
      return () => clearInterval(t);
    } else {
      setTimeLeft(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, challenge?.challengeId, battleStartedAt, selectedRoomId]);

  // Auto-submit whatever prompt is written when the timer hits 0.
  useEffect(() => {
    if (phase === "playing" && timeLeft === 0 && challenge && !submitting && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      if (prompt.trim()) handleSubmitPrompt();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase]);

  // Practice Mode — load the SAME challenge currently set for the room players,
  // so solo practice mirrors the live booth challenge.
  const loadSoloChallenge = async () => {
    if (!isValidEmail(playerEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setPhase("loading");
    setChallenge(null);
    setPrompt("");
    setUserVideo(null);
    setResult(null);
    setVideoScore(null);
    setScoring(false);
    setVideoFeedback(null);
    setError(null);
    setSelectedRoomId(null);

    try {
      // Prefer the room's active challenge; fall back to a random one if none set.
      const roomsRes = await fetch("/api/rooms");
      const roomsData = await roomsRes.json();
      const activeChallenge = Array.isArray(roomsData) ? roomsData[0]?.challengeDetails : null;
      if (activeChallenge) {
        setChallenge(activeChallenge);
        setPhase("playing");
        return;
      }
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

  // Publish the player's score to the GLOBAL leaderboard exactly once, using the
  // composite (text + video) score so the board reflects combined similarity.
  // Posted at submit (text only) and again once video similarity resolves
  // (composite). The global leaderboard upserts by player, so the second call
  // updates the same entry in place rather than duplicating it.
  const publishGlobalScore = async (compositeScore: number, vScore: number | null) => {
    const ctx = pollCtxRef.current;
    const textScore = ctx?.score.score ?? result?.score ?? compositeScore;
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "global",
          playerName: ctx?.playerName ?? (playerName.trim() || "Anonymous Player"),
          similarityScore: textScore,
          compositeScore,
          videoScore: vScore ?? undefined,
          timeTakenToPrompt: ctx?.timeTakenToPrompt ?? 60,
          email: ctx?.email ?? playerEmail.trim(),
        }),
      });
    } catch {}
  };

  // Poll for the generated video while in "generating" phase. Once the video is
  // ready we go STRAIGHT to results so the player can watch their output. The
  // similarity score is then computed in the background (see the scoring effect
  // below) and revealed once ready — the score area shows a loading effect
  // meanwhile, so the first number shown is always the final composite (never a
  // text score that gets overwritten).
  useEffect(() => {
    if (phase !== "generating" || !requestId) return;
    let cancelled = false;
    // Guards against the 3s interval firing twice once we've handled a result.
    let finalizing = false;

    const poll = async () => {
      if (cancelled || finalizing) return;
      try {
        const res = await fetch(`/api/generate-poll?requestId=${requestId}`);
        const data = await res.json();
        const ctx = pollCtxRef.current;
        if (cancelled || !ctx) return;

        if (data.status === "COMPLETED") {
          finalizing = true;
          setResult(ctx.score);
          if (data.videoUrl) {
            // Show the video immediately and kick off background scoring.
            setUserVideo({ videoUrl: data.videoUrl, promptUsed: ctx.prompt });
            setScoring(true);
          } else {
            // No video produced — the prompt score is the final score.
            publishGlobalScore(ctx.score.score, null);
            setScoring(false);
          }
          setRequestId(null);
          setPhase("results");
        } else if (data.status === "FAILED" || data.error) {
          finalizing = true;
          setError(formatApiError(data, "Video generation failed."));
          publishGlobalScore(ctx.score.score, null);
          setResult(ctx.score);
          setScoring(false);
          setRequestId(null);
          setPhase("results");
        }
        // IN_QUEUE / IN_PROGRESS → keep polling
      } catch {}
    };

    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, phase]);

  // Background video-similarity scoring. Runs once we're on the results screen
  // with a generated video. Independent of the polling effect so it survives the
  // phase change. Publishes the final composite to the leaderboard exactly once.
  useEffect(() => {
    if (phase !== "results" || !scoring || !userVideo || videoScore != null) return;
    const ctx = pollCtxRef.current;
    if (!ctx?.challengeId) { setScoring(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const vs = await fetch("/api/video-similarity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: ctx.challengeId,
            userVideoUrl: userVideo.videoUrl,
            textScore: ctx.score.score,
            roomId: ctx.roomId ?? "",
            playerName: ctx.playerName,
            submissionTimestamp: ctx.submissionTimestamp,
          }),
        }).then(r => r.json());
        if (cancelled) return;

        if (vs.videoScore != null) {
          const composite = vs.compositeScore ?? computeFinalScore(ctx.score.score, vs.videoScore)!;
          if (vs.feedback) setVideoFeedback(vs.feedback);
          setVideoScore(vs.videoScore);
          publishGlobalScore(composite, vs.videoScore);
        } else {
          // Similarity unavailable — final score is the prompt score.
          publishGlobalScore(ctx.score.score, null);
        }
      } catch {
        if (!cancelled) publishGlobalScore(ctx.score.score, null);
      } finally {
        if (!cancelled) setScoring(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scoring, userVideo]);

  // Fire the winner confetti burst the moment the room's standings resolve
  // (every player scored) AND this player is ranked #1 — exactly once per round.
  useEffect(() => {
    if (phase !== "results" || !selectedRoomId || !roomState || celebratedRef.current) return;
    const ev = evaluateRound(roomState);
    if (ev.resolved && ev.ranked[0]?.playerName.toLowerCase() === playerName.trim().toLowerCase()) {
      celebratedRef.current = true;
      setConfettiBurstId((id) => id + 1);
    }
  }, [phase, roomState, selectedRoomId, playerName]);

  // Submit Prompt — score first, then generate a video. In solo practice the
  // video is only generated when the prompt similarity is strong (>70).
  const handleSubmitPrompt = async () => {
    if (!challenge || !prompt.trim()) return;
    const name = playerName.trim() || "Anonymous Player";
    setPlayerName(name);
    setPlayerNameState(name);
    setSubmitting(true);
    setError(null);
    setVideoGated(false);
    setVideoFeedback(null);

    try {
      // Score the prompt first — needed to decide whether to spend a video generation.
      const scoreRes = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, userPrompt: prompt.trim(), playerName: name }),
      });
      const scoreData = (await scoreRes.json()) as ScoreResult;
      if (!scoreRes.ok) throw new Error(formatApiError(scoreData as any, "Scoring failed."));

      const submissionTimestamp = Date.now();
      const timeTakenToPrompt = challengeStartTimeRef.current
        ? Math.min(60, Math.round((submissionTimestamp - challengeStartTimeRef.current) / 1000))
        : 60;
      const videoTag = challenge?.theme ?? "";
      pollCtxRef.current = {
        score: scoreData,
        playerName: name,
        roomId: selectedRoomId,
        prompt: prompt.trim(),
        submissionTimestamp,
        challengeId: challenge?.challengeId ?? "",
        timeTakenToPrompt,
        email: playerEmail.trim(),
        videoTag,
        difficulty: challenge?.difficulty ?? "medium",
        // The timer's auto-submit sets this ref true before calling us.
        autoSubmitted: autoSubmittedRef.current,
      };

      // Record the score IMMEDIATELY on submit (text only) so the admin standings
      // show "submitted" right away. Awaited so the admin sees the status change
      // on its next poll rather than after a multi-second delay.
      if (selectedRoomId) {
        await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "room",
            playerName: name,
            similarityScore: scoreData.score,
            timeTakenToPrompt,
            roomId: selectedRoomId,
            prompt: prompt.trim(),
            timestamp: submissionTimestamp,
            email: playerEmail.trim(),
            challengeId: challenge?.challengeId ?? "",
            videoTag,
            difficulty: challenge?.difficulty ?? "medium",
            autoSubmitted: autoSubmittedRef.current,
          }),
        }).catch(() => {});
      }

      // Show the result for paths where no video is produced. Here the prompt
      // score IS the final score, so we publish it once (no later overwrite).
      const finishTextOnly = () => {
        publishGlobalScore(scoreData.score, null);
        setResult(scoreData);
        setPhase("results");
      };

      // Solo practice: only generate a video for strong prompts (>70).
      if (!selectedRoomId && scoreData.score <= 70) {
        setVideoGated(true);
        finishTextOnly();
        return;
      }

      // Queue the video generation.
      const genRes = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt: prompt.trim(), playerName: name }),
      });
      const genData = await genRes.json();

      if (!genData.requestId) {
        // No FAL_KEY or submit failed — show results with score only
        if (genData.error && !genData.skipped) {
          setError(formatApiError(genData, "Video generation unavailable."));
        }
        finishTextOnly();
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

  const goToGlobalLeaderboard = () => {
    if (goingGlobal) return;
    setGoingGlobal(true);
    router.push("/leaderboard");
  };

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  // Join Room button click — uses the multiplayer card's own details, then
  // promotes them to the active identity used by the rest of the game flow.
  const handleJoinRoom = (room: RoomListItem) => {
    if (!mpName.trim()) {
      setError("Please enter your name first.");
      return;
    }
    if (!isValidEmail(mpEmail)) {
      setMpEmailError("Enter a valid email address.");
      return;
    }
    setMpEmailError(null);
    setError(null);
    const name = mpName.trim();
    setPlayerName(name);
    setPlayerNameState(name);
    setPlayerEmail(mpEmail.trim());
    // Re-baseline reset detection so we only react to resets after this join.
    resetBaselineRef.current = undefined;
    roundKeyRef.current = "";
    setSelectedRoomId(room.id);
    setPhase("loading");
  };

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] flex flex-col justify-between overflow-hidden">

      {/* Last-10s urgency: pulsing red vignette over the whole screen */}
      {phase === "playing" && timeLeft !== null && timeLeft <= 10 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: timeLeft === 0 ? [0.3, 0.7, 0.3] : [0.15, 0.45, 0.15] }}
          transition={{ duration: timeLeft === 0 ? 0.5 : 1, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none fixed inset-0 z-40"
          style={{ boxShadow: "inset 0 0 150px 35px rgba(244,63,94,0.6)" }}
        />
      )}

      {/* TIME'S UP flash while the prompt auto-submits */}
      <AnimatePresence>
        {phase === "playing" && timeLeft === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 16 }}
              className="rounded-2xl border border-rose-500/50 bg-black/85 px-8 py-5 text-center backdrop-blur"
            >
              <p className="text-2xl sm:text-3xl font-extrabold tracking-widest text-rose-400 font-mono">TIME&apos;S UP!</p>
              <p className="mt-1.5 text-xs text-zinc-400 font-mono">
                {prompt.trim() ? "Submitting your prompt…" : "Time ran out — no prompt entered."}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mx-auto w-full max-w-6xl px-4 py-6 flex-1 flex flex-col min-h-0">

        {/* ── HEADER BAR ──────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3.5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight text-white uppercase">
              {phase === "lobby" ? "Select Game Mode" : selectedRoomId ? "Multiplayer Synced Match" : "Solo Match Practice"}
            </h1>
            {selectedRoomId && roomState && (
              <span className="flex items-center gap-2 rounded-lg bg-[#0066FF]/10 border border-[#0066FF]/30 px-3 py-1.5 text-xs text-[#0066FF] font-mono font-semibold">
                <span className="h-2 w-2 rounded-full bg-[#0066FF] sync-dot" />
                {roomState.name}
              </span>
            )}
            {challenge && phase === "playing" && (
              <span className="text-xs font-semibold text-zinc-500 font-mono hidden sm:inline">
                Theme: {challenge.theme}
              </span>
            )}
          </div>

          <div className="flex items-stretch gap-3">
            {/* Challenge timer — visible only while playing */}
            {phase === "playing" && <ChallengeTimer seconds={timeLeft} />}

            {/* User Badge — mirrors the timer stat-chip (icon + label + value) */}
            {phase !== "lobby" && (
              <div className="flex items-center gap-2.5 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5">
                <svg className="h-5 w-5 flex-shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
                </svg>
                <div className="flex flex-col leading-none">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-zinc-500 mb-1">Player</span>
                  <span className="font-mono font-bold text-base text-white leading-none truncate max-w-[140px]">{playerName}</span>
                </div>
                <button
                  onClick={() => {
                    setSelectedRoomId(null);
                    setPhase("lobby");
                    setChallenge(null);
                  }}
                  className="ml-1 self-stretch flex items-center border-l border-zinc-800 pl-3 text-xs font-semibold text-zinc-400 hover:text-rose-300 transition-colors"
                >
                  Exit
                </button>
              </div>
            )}
          </div>
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
                className="flex items-center justify-center w-full my-auto"
              >
                {/* Solo / Practice mode — temporarily disabled (flip false → true to restore) */}
                {false && (
                <motion.div
                  whileHover={{ y: -3 }}
                  className="graphite-card p-6 flex flex-col justify-between"
                >
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight">1. Participant Registry</h2>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      Specify your username below to log your scores on the live leaderboards.
                    </p>
                    <div className="mt-5 space-y-3">
                      <div>
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
                      <div>
                        <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">
                          Email Address
                        </label>
                        <input
                          type="email"
                          value={playerEmail}
                          onChange={(e) => { setPlayerEmail(e.target.value); setEmailError(null); }}
                          placeholder="you@example.com"
                          className="input-field"
                        />
                        {emailError && <p className="mt-1.5 text-xs text-rose-400 font-mono">{emailError}</p>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-zinc-850">
                    <h3 className="text-sm font-bold text-white">Option A: Practice Mode</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      Practice on the same challenge the room is currently playing. A video is generated only when your prompt scores above 70.
                    </p>
                    <button
                      onClick={loadSoloChallenge}
                      className="btn-secondary w-full mt-4 text-sm"
                    >
                      Start Solo Match
                    </button>
                  </div>
                </motion.div>
                )}

                {/* Sync Multiplayer — single centered card */}
                <motion.div
                  whileHover={{ y: -3 }}
                  className="graphite-card p-6 flex flex-col w-full max-w-md"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white tracking-tight">Sync Multiplayer</h2>
                    <button
                      onClick={() => fetchRooms()}
                      disabled={loadingRooms}
                      className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1.5 transition"
                    >
                      <svg className={`h-4 w-4 ${loadingRooms ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.235" />
                      </svg>
                      Refresh
                    </button>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Join the live battle session — you'll be placed in the next open spot.
                  </p>

                  {/* Multiplayer participant details (separate from solo) */}
                  <div className="mt-5 space-y-3">
                    <div>
                      <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">
                        Participant Username
                      </label>
                      <input
                        type="text"
                        value={mpName}
                        onChange={(e) => setMpName(e.target.value)}
                        placeholder="e.g. CyberRider"
                        maxLength={18}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase font-bold text-zinc-500 font-mono mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={mpEmail}
                        onChange={(e) => { setMpEmail(e.target.value); setMpEmailError(null); }}
                        placeholder="you@example.com"
                        className="input-field"
                      />
                      {mpEmailError && <p className="mt-1.5 text-xs text-rose-400 font-mono">{mpEmailError}</p>}
                    </div>
                  </div>

                  {(() => {
                    const room = rooms[0];
                    if (!room && !loadingRooms) {
                      return (
                        <div className="mt-5 flex-1 flex items-center justify-center text-center py-8 text-xs text-zinc-500 font-mono border border-dashed border-zinc-800 rounded">
                          No active battle session detected.<br />Waiting for the booth admin to set one up.
                        </div>
                      );
                    }
                    if (!room) {
                      return (
                        <div className="mt-5 flex-1 flex items-center justify-center py-6">
                          <div className="h-5 w-5 rounded-full border-2 border-[#0066FF] border-t-transparent animate-spin" />
                        </div>
                      );
                    }

                    const isFull = !room.slots.some(s => s === null);

                    return (
                      <div className="mt-5">
                        <button
                          onClick={() => handleJoinRoom(room)}
                          disabled={isFull}
                          className="btn-primary w-full py-3 text-sm font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isFull ? `Room Full (${room.maxUsers}/${room.maxUsers})` : "Join Now"}
                        </button>
                        {isFull && (
                          <p className="mt-2 text-[11px] text-zinc-500 font-mono text-center">
                            All {room.maxUsers} spots are taken — please wait for one to free up.
                          </p>
                        )}
                      </div>
                    );
                  })()}

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

            {/* WAITING FOR PLAYERS — battle starts when full or host starts it */}
            {phase === "waiting" && (() => {
              const joined = roomState?.players?.length ?? 0;
              const max = roomState?.maxUsers ?? 0;
              const hasChallenge = !!roomState?.activeChallengeId;
              return (
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="flex flex-col items-center justify-center flex-1 py-12 px-4 my-auto"
                >
                  <div className="graphite-card p-8 w-full max-w-md text-center">
                    {/* Centered animated logo (standalone — nothing overlaid) */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/logo_compressed.gif"
                      alt="DataHack Summit"
                      className="mx-auto h-32 w-32 object-contain mb-4"
                    />

                    {/* Summit branding */}
                    <p className="text-[10px] uppercase tracking-[0.2em] font-mono font-bold mb-4">
                      <span className="dhs-wordmark">DataHack Summit</span>
                      <span className="text-zinc-600"> · 7th Edition</span>
                    </p>

                    <h2 className="text-lg font-bold text-white">
                      {hasChallenge ? "Waiting for Players" : "Waiting for the Host"}
                    </h2>

                    {/* Player count — shown separately from the orb */}
                    <p className="mt-2 font-mono font-bold">
                      <span className="text-2xl text-[#0066FF]">{joined}</span>
                      <span className="text-zinc-500 text-lg"> / {max}</span>
                      <span className="text-zinc-500 text-xs font-normal ml-1.5">players joined</span>
                    </p>
                    <p className="mt-2 text-xs sm:text-sm text-zinc-400 leading-relaxed">
                      {hasChallenge
                        ? "The battle begins automatically once everyone joins — or when the host starts it."
                        : "The host is choosing the challenge. Hang tight!"}
                    </p>

                    {roomState?.challengeDetails && (
                      <div className="mt-4 inline-flex items-center gap-2 rounded border border-zinc-800 bg-black/40 px-3 py-1.5">
                        <span className="text-xs text-zinc-300 font-mono">{roomState.challengeDetails.theme}</span>
                      </div>
                    )}

                    {/* Player chips + empty spots */}
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {roomState?.players?.map((p) => {
                        const isMe = p.playerName.toLowerCase() === playerName.toLowerCase();
                        return (
                          <span
                            key={p.playerName}
                            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-mono border ${
                              isMe ? "bg-[#0066FF]/10 border-[#0066FF]/30 text-[#0066FF] font-semibold" : "bg-zinc-900/60 border-zinc-800 text-zinc-300"
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            {p.playerName}{isMe && " (you)"}
                          </span>
                        );
                      })}
                      {Array.from({ length: Math.max(0, max - joined) }).map((_, i) => (
                        <span key={`empty-${i}`} className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-mono border border-dashed border-zinc-800 text-zinc-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-700 animate-pulse" />
                          waiting…
                        </span>
                      ))}
                    </div>

                    <p className="mt-6 text-[11px] text-zinc-600 font-mono">
                      Keep this screen open — the battle starts for everyone at once.
                    </p>
                  </div>
                </motion.div>
              );
            })()}

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
                      disabled={!challenge || timeLeft === 0}
                      className={`flex-1 resize-none bg-transparent p-4 text-xs sm:text-sm leading-relaxed text-white outline-none disabled:opacity-60 ${voiceStatus === "recording" ? "placeholder:text-[#0066FF]/60 placeholder:animate-pulse" : "placeholder:text-zinc-700"}`}
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
                {/* VR gaming illustration — plays while the video renders */}
                <div className="relative h-48 w-48 mb-4">
                  <div className="absolute inset-0 rounded-full bg-[#0066FF]/15 blur-2xl" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/animations/gaming-vr-blue.svg" alt="" className="relative h-full w-full object-contain" />
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
                {/* Generation error notice */}
                {error && !userVideo && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400 font-semibold text-center">
                    {error} — your score is still recorded.
                  </div>
                )}
                {/* Practice-mode gate notice */}
                {videoGated && !userVideo && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400 font-semibold text-center">
                    Reach 70+ prompt similarity to unlock video generation. Try a sharper prompt!
                  </div>
                )}
                {/* Winner celebration burst — fires once when standings resolve in my favor */}
                <ConfettiBurst triggerKey={confettiBurstId} />

                {(() => {
                  // My own score is independent of the room — it's ready as soon as MY
                  // video similarity resolves, regardless of other players' progress.
                  const myFinalScore = computeFinalScore(result.score, videoScore);
                  const headline = myFinalScore == null ? "Calculating your final score…" : evaluationRemark(myFinalScore);
                  const subtext = myFinalScore == null
                    ? "Please wait — analyzing your video against the reference"
                    : "Based on combined prompt (40%) + video similarity (60%)";

                  // Room standings are gated on EVERY player finishing — see evaluateRound().
                  const roundEval = selectedRoomId && roomState ? evaluateRound(roomState) : null;
                  const amWinner = !!roundEval?.resolved
                    && roundEval.ranked[0]?.playerName.toLowerCase() === playerName.trim().toLowerCase();

                  return (
                    <>
                      {/* TOP ROW: my score circle (left) + battle standings (right) */}
                      <div className={selectedRoomId ? "grid gap-4 lg:grid-cols-[minmax(0,300px)_1fr] items-stretch" : ""}>
                        <MyScoreCard finalScore={myFinalScore} headline={headline} subtext={subtext} amWinner={amWinner} />
                        {selectedRoomId && roomState && roundEval && (
                          <StandingsCard
                            ranked={roundEval.ranked}
                            resolved={roundEval.resolved}
                            finishedCount={roundEval.finishedCount}
                            totalCount={roundEval.totalCount}
                            myName={playerName}
                          />
                        )}
                      </div>

                      {/* Evaluation details — only shown once MY final score is ready */}
                      {myFinalScore != null && (
                        <div className="graphite-card p-4 sm:p-5 space-y-3">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 font-mono">Evaluation Details</p>
                          <div className="flex gap-3">
                            <span className="mt-0.5 text-[10px] font-bold font-mono text-[#0066FF] uppercase w-12 flex-shrink-0">Prompt</span>
                            <p className="flex-1 text-xs text-zinc-300 leading-relaxed">{result.feedback}</p>
                          </div>
                          <div className="flex gap-3 border-t border-zinc-900 pt-3">
                            <span className="mt-0.5 text-[10px] font-bold font-mono text-[#8b5cf6] uppercase w-12 flex-shrink-0">Video</span>
                            <p className="flex-1 text-xs text-zinc-300 leading-relaxed">
                              {videoFeedback ?? (userVideo ? "Video comparison unavailable for this attempt." : "No video was generated for this attempt.")}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Side-by-side dual video */}
                      {userVideo && <DualVideo originalSrc={challenge.videoUrl} userSrc={userVideo.videoUrl} />}

                      {/* Your prompt */}
                      <div className="graphite-card px-4 py-3">
                        <p className="text-[10px] uppercase font-bold text-zinc-600 font-mono mb-1">Your Prompt</p>
                        <p className="text-xs text-zinc-300 italic font-mono leading-relaxed">{prompt}</p>
                      </div>
                    </>
                  );
                })()}

                {/* Final action bar — only the leaderboard button remains */}
                <div className="flex border-t border-zinc-900 pt-4 mt-2">
                  <button
                    onClick={goToGlobalLeaderboard}
                    disabled={goingGlobal}
                    className="btn-primary flex-1 py-3 text-sm font-bold"
                  >
                    {goingGlobal ? "Publishing…" : "View Leaderboard →"}
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
