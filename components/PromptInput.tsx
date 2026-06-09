"use client";

import { motion } from "framer-motion";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function PromptInput({
  value,
  onChange,
  disabled = false,
  placeholder = "Describe the scene you believe the AI imagined...",
}: PromptInputProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card w-full p-1"
    >
      <label className="mb-2 block text-xs font-medium uppercase tracking-widest text-cyan-400/80">
        Your Prompt Guess
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={4}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-base text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:outline-none focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p className="mt-2 text-xs text-zinc-500">
        Tip: Include subject, setting, mood, lighting, and camera style.
      </p>
    </motion.div>
  );
}
