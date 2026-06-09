"use client";

import { motion } from "framer-motion";

const MESSAGES = [
  "Analyzing cinematic semantics...",
  "Mapping latent visual tokens...",
  "Comparing narrative embeddings...",
  "Rendering similarity matrix...",
];

export default function Loader() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="glass-card flex flex-col items-center justify-center gap-6 py-16 px-6"
    >
      <div className="relative h-24 w-24">
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-cyan-400/20"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-2 rounded-full border-2 border-t-cyan-400 border-r-transparent border-b-violet-500 border-l-transparent"
          animate={{ rotate: -360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-6 rounded-full bg-gradient-to-br from-cyan-400/30 to-violet-600/30 blur-sm"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">
          ✦
        </div>
      </div>

      <motion.p
        key={MESSAGES[0]}
        className="text-center text-lg font-medium text-cyan-200"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {MESSAGES[0]}
      </motion.p>

      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-cyan-400"
            animate={{ y: [0, -8, 0], opacity: [0.4, 1, 0.4] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.15,
            }}
          />
        ))}
      </div>

      <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full bg-gradient-to-r from-cyan-400 to-violet-500"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 2.5, ease: "easeInOut" }}
        />
      </div>
    </motion.div>
  );
}
