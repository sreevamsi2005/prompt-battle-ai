"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useAdminAuth } from "@/contexts/admin-auth";

const links = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { isAdmin, setIsAdmin } = useAdminAuth();

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800 bg-[#000000]/85 backdrop-blur-md"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <motion.span
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              className="relative flex h-7 w-7 items-center justify-center rounded bg-white text-xs font-bold text-black"
            >
              PB
              <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#0066FF] border border-black" />
            </motion.span>
            <span className="text-sm font-semibold tracking-tight text-white transition-colors group-hover:text-zinc-300">
              PromptBattle <span className="text-zinc-500 font-normal font-mono text-xs">AI</span>
            </span>
          </Link>

          <div className="hidden sm:flex items-center gap-1.5">
            {links.map((link) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-md bg-zinc-900 border border-zinc-800"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Mobile visible links */}
          <div className="flex sm:hidden items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${active ? "text-white bg-zinc-900 border border-zinc-850" : "text-zinc-400"}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {isAdmin ? (
            <button
              onClick={() => setIsAdmin(false)}
              className="rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 hover:text-white px-3 py-1.5 text-xs font-medium text-zinc-200 transition"
            >
              Sign Out
            </button>
          ) : (
            <Link
              href="/admin"
              className="rounded border border-zinc-800 bg-[#09090b]/80 hover:bg-zinc-900 hover:text-white px-3 py-1.5 text-xs font-medium text-zinc-300 transition"
            >
              Admin Panel
            </Link>
          )}
        </div>
      </div>
    </motion.nav>
  );
}
