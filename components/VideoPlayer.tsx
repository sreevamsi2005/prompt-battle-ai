"use client";

import { motion } from "framer-motion";

interface VideoPlayerProps {
  src: string;
  label?: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export default function VideoPlayer({
  src,
  label,
  className = "",
  autoPlay = true,
  loop = true,
  muted = true,
}: VideoPlayerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black/60 shadow-[0_0_40px_rgba(139,92,246,0.15)] ${className}`}
    >
      {label && (
        <div className="absolute left-4 top-4 z-10 rounded-full border border-cyan-400/30 bg-black/50 px-3 py-1 text-xs font-medium uppercase tracking-widest text-cyan-300 backdrop-blur-md">
          {label}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent z-[1]" />
      <video
        key={src}
        src={src}
        className="aspect-video w-full object-cover"
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
      />
    </motion.div>
  );
}
