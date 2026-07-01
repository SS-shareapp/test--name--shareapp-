"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";

export default function Nav() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("flock-theme");
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const initial = saved ? (saved as "dark" | "light") : (mq.matches ? "light" : "dark");
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("flock-theme", next);
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-14 py-5 bg-[var(--nav-bg)] backdrop-blur-xl border-b border-[var(--border)]">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" theme={theme} />
        <span className="text-2xl font-bold grad-text">
          flock
        </span>
      </Link>

      {/* Center links */}
      <div className="hidden md:flex items-center gap-9">
        <a href="#how" className="text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors">How it works</a>
        <a href="#pricing" className="text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors">Pricing</a>
        <a href="#" className="text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors">Docs</a>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="w-9 h-9 rounded-full border border-[var(--border)] flex items-center justify-center text-sm hover:border-[var(--violet)] transition-colors"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <SignedOut>
          <SignInButton mode="modal">
            <button className="text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors px-4 py-2">
              Sign in
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
        <Link
          href="/receive"
          className="bg-[var(--grad)] text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:opacity-85 transition-opacity"
        >
          Receive File
        </Link>
      </div>
    </nav>
  );
}
