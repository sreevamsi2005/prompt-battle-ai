"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useMotionValue, useTransform } from "framer-motion";

// Custom 3D Tilt Card Component
function TiltCard({ step, title, desc, icon }: { step: string, title: string, desc: string, icon: React.ReactNode }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Map mouse coordinates to rotation angles (max 15 degrees)
  const rotateX = useTransform(y, [-100, 100], [15, -15]);
  const rotateY = useTransform(x, [-100, 100], [-15, 15]);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = event.clientX - rect.left - width / 2;
    const mouseY = event.clientY - rect.top - height / 2;
    x.set(mouseX);
    y.set(mouseY);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
      }}
      className="graphite-card p-6 relative flex flex-col text-left transition-all duration-200 ease-out hover:border-[#0066FF] hover:shadow-[0_0_30px_rgba(0,102,255,0.15)]"
    >
      <div 
        style={{ transform: "translateZ(40px)" }} 
        className="absolute top-4 right-4 text-sm font-mono font-bold text-zinc-700"
      >
        {step}
      </div>
      <div 
        style={{ transform: "translateZ(30px)" }} 
        className="mb-4 flex h-10 w-10 items-center justify-center rounded bg-zinc-900 border border-zinc-800"
      >
        {icon}
      </div>
      <h3 
        style={{ transform: "translateZ(20px)" }} 
        className="text-base font-bold text-white tracking-tight"
      >
        {title}
      </h3>
      <p 
        style={{ transform: "translateZ(10px)" }} 
        className="mt-2 text-sm leading-relaxed text-zinc-400"
      >
        {desc}
      </p>
    </motion.div>
  );
}

const features = [
  {
    title: "1. Watch Stream",
    desc: "A cinematic AI-generated video loop is served. Study the visuals, style, motion, and frames.",
    icon: (
      <svg className="h-5 w-5 text-[#0066FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    step: "01",
  },
  {
    title: "2. Reverse Prompt",
    desc: "Describe the clip as a detailed text prompt, guessing subject details and camera parameters.",
    icon: (
      <svg className="h-5 w-5 text-[#0066FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
    step: "02",
  },
  {
    title: "3. Evaluate Match",
    desc: "AI compares your input against the original prompt, renders your user video, and ranks you live.",
    icon: (
      <svg className="h-5 w-5 text-[#0066FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
    step: "03",
  },
];

export default function HomePage() {
  return (
    <div className="relative h-[calc(100vh-3.5rem)] flex flex-col justify-between overflow-hidden">
      {/* Immersive background layout overlay */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[500px] w-[700px] rounded-full bg-[#0066FF]/10 blur-[150px]" />
      </div>

      {/* Main hero segment */}
      <section className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pt-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-[#09090b]/80 px-3 py-1 text-xs text-zinc-400 backdrop-blur"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0066FF] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#0066FF]" />
          </span>
          GenAI Summit Booth Live Battle
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-5xl font-black tracking-tight sm:text-7xl md:text-8xl text-white uppercase select-none"
        >
          PROMPT <span className="text-[#0066FF] tracking-tighter">BATTLE</span>
          <span className="ml-3 inline-flex items-center align-middle rounded border border-zinc-800 bg-[#09090b] px-3 py-1 text-xs sm:text-sm font-mono font-bold text-zinc-400">
            AI
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-4 max-w-xl text-base leading-relaxed text-zinc-300"
        >
          Watch the source video. Decode the cinematic parameters. Enter your text description, and see how closely your model renders match the original.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.28 }}
          className="mt-8 flex flex-col items-center gap-3.5 sm:flex-row"
        >
          <Link href="/play" className="btn-primary px-10 py-3 text-base">
            Start Challenge
          </Link>
          <Link href="/leaderboard" className="btn-secondary px-8 py-3 text-base">
            View Leaderboard
          </Link>
        </motion.div>
      </section>

      {/* Grid of instructions - Single viewport constraint */}
      <section className="relative mx-auto w-full max-w-5xl px-4 pb-14 mt-6">
        <div className="perspective-1000 grid gap-4 sm:grid-cols-3">
          {features.map((f, i) => (
            <TiltCard
              key={f.title}
              step={f.step}
              title={f.title}
              desc={f.desc}
              icon={f.icon}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
