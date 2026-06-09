"use client";

import { motion } from "framer-motion";

interface ScoreCardProps {
  score: number;
  feedback: string;
}

function getScoreColor(score: number) {
  if (score >= 76) return "from-emerald-400 to-cyan-400";
  if (score >= 40) return "from-amber-400 to-orange-500";
  return "from-rose-400 to-violet-500";
}

function getScoreLabel(score: number) {
  if (score >= 76) return "Cinematic Match";
  if (score >= 40) return "Partial Resonance";
  return "Semantic Drift";
}

export default function ScoreCard({ score, feedback }: ScoreCardProps) {
  const color = getScoreColor(score);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="glass-card overflow-hidden"
    >
      <div className="flex flex-col items-center gap-4 p-8 sm:flex-row sm:items-start sm:gap-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 260 }}
          className="relative flex h-36 w-36 shrink-0 items-center justify-center"
        >
          <div
            className={`absolute inset-0 rounded-full bg-gradient-to-br ${color} opacity-20 blur-2xl`}
          />
          <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="8"
            />
            <motion.circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="url(#scoreGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={326.7}
              initial={{ strokeDashoffset: 326.7 }}
              animate={{ strokeDashoffset: 326.7 - (326.7 * score) / 100 }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
            />
            <defs>
              <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className={`bg-gradient-to-br ${color} bg-clip-text text-4xl font-bold text-transparent`}
            >
              {score}
            </motion.span>
            <span className="text-xs uppercase tracking-widest text-zinc-400">
              / 100
            </span>
          </div>
        </motion.div>

        <div className="flex-1 text-center sm:text-left">
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className={`inline-block rounded-full bg-gradient-to-r ${color} px-3 py-1 text-xs font-semibold uppercase tracking-wider text-black`}
          >
            {getScoreLabel(score)}
          </motion.span>
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-3 text-xl font-semibold text-white"
          >
            AI Feedback
          </motion.h3>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.65 }}
            className="mt-2 text-zinc-300 leading-relaxed"
          >
            {feedback}
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
