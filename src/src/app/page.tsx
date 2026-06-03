"use client";

import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CHUNK_SIZE, MAX_FILE_BYTES } from "@/lib/constants";
import { encryptChunk, decryptChunk, keyFromCode, randomSalt, sha256Hex } from "@/lib/browser-crypto";
import { formatBytes } from "@/lib/utils";
import Nav from "./components/Nav";

type UploadChunk = { idx: number; putUrl: string };
type CreateShareResponse = {
  code: string;
  fileId: string;
  chunkSize: number;
  chunkCount: number;
  expiresAt: string;
  chunks: UploadChunk[];
};

export default function Home() {
  const { getToken, isSignedIn } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [shareCode, setShareCode] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);

  const pct = useMemo(() => Math.round(progress * 100), [progress]);

  // Scroll reveal
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("in");
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // API helpers
  async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  function uploadChunk(
    url: string,
    body: Blob,
    onProgress: (uploadedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();

      request.open("PUT", url);
      request.setRequestHeader("Content-Type", "application/octet-stream");
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded, event.total);
        }
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress(body.size, body.size);
          resolve();
          return;
        }
        reject(new Error(`Upload failed with status ${request.status}`));
      };
      request.onerror = () => reject(new Error("Upload failed"));
      request.onabort = () => reject(new Error("Upload cancelled"));
      request.send(body);
    });
  }

  function selectFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setStatus("error");
      setStatusMsg("File exceeds 1 GiB limit.");
      return;
    }
    setFile(f);
    setShareCode("");
    setStatus("idle");
  }

  async function sendFile(): Promise<void> {
    if (!file) return;
    if (!isSignedIn) {
      setStatus("error");
      setStatusMsg("Please sign in to upload files.");
      return;
    }
    setBusy(true);
    setStatus("working");
    setProgress(0);
    setShareCode("");
    try {
      setStatusMsg("Hashing...");
      const salt = randomSalt();
      const fileSha256 = await sha256Hex(file);
      setStatusMsg("Creating share...");
      const res = await authFetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          sizeBytes: file.size,
          chunkSize: DEFAULT_CHUNK_SIZE,
          fileSha256,
          salt,
        }),
      });
      const data = (await res.json()) as CreateShareResponse | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Failed");
      setShareCode(data.code);
      setStatusMsg("Preparing encryption...");
      const key = await keyFromCode(data.code, salt);
      for (const chunk of data.chunks) {
        const start = chunk.idx * data.chunkSize;
        const plain = file.slice(start, Math.min(start + data.chunkSize, file.size));
        setStatusMsg(`Encrypting & uploading ${chunk.idx + 1}/${data.chunkCount}`);
        const enc = await encryptChunk(plain, chunk.idx, key);
        setProgress(chunk.idx / data.chunkCount);
        await uploadChunk(chunk.putUrl, enc, (uploadedBytes, totalBytes) => {
          const chunkProgress = totalBytes > 0 ? uploadedBytes / totalBytes : 0;
          setProgress((chunk.idx + chunkProgress) / data.chunkCount);
        });
        await authFetch(`/api/files/${data.fileId}/chunks/${chunk.idx}`, { method: "PUT" });
        setProgress((chunk.idx + 1) / data.chunkCount);
      }
      const complete = await authFetch(`/api/files/${data.fileId}/complete`, { method: "POST" });
      if (!complete.ok) throw new Error("Could not finalize upload");
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setStatusMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(shareCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // 3D tilt handlers
  function handleTilt(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    e.currentTarget.style.transform = `perspective(800px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-6px)`;
  }
  function handleTiltLeave(e: React.MouseEvent<HTMLDivElement>) {
    e.currentTarget.style.transform = "";
  }

  const steps = [
    { num: "01", title: "Drop your file", desc: "Drag and drop any file, or browse. Any size up to 1 GiB.", pct: 25 },
    { num: "02", title: "We encrypt it", desc: "AES-256-GCM encryption happens in your browser. Zero-knowledge.", pct: 50 },
    { num: "03", title: "Get your code", desc: "A unique share code is generated. The code IS the decryption key.", pct: 75 },
    { num: "04", title: "Share anywhere", desc: "Send the code via any channel. Recipient enters it to download.", pct: 100 },
  ];

  const marqueeItems = [
    "End-to-end encrypted",
    "No file size limits",
    "Zero-knowledge",
    "Self-destructing",
    "Global CDN",
    "Chunked uploads",
    "No account needed",
    "AES-256-GCM",
  ];

  return (
    <>
      <Nav />

      {/* ─── HERO ─── */}
      <section className="relative z-10 min-h-screen flex items-center pt-24 pb-20 px-6 md:px-14">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left column */}
          <div className="flex flex-col gap-6" style={{ animation: "fadeUp 0.8s ease both" }}>
            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] tracking-tight">
              Share files<br />
              <em className="italic font-light">like a </em><span className="grad-text">flock.</span>
            </h1>

            <p className="text-base md:text-lg text-[var(--muted)] max-w-md leading-relaxed">
              Drop your files. Get a code instantly. End-to-end encrypted, no sign-up required. Just share and fly.
            </p>

            <div className="flex items-center gap-3 mt-2">
              <SignedIn>
                <button
                  className="bg-[var(--grad)] text-white px-7 py-3.5 rounded-full text-base font-semibold hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
                  onClick={file ? sendFile : () => fileInputRef.current?.click()}
                  disabled={busy || status === "working"}
                >
                  {status === "working" ? "Uploading..." : "Upload Files"}
                </button>
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="bg-[var(--grad)] text-white px-7 py-3.5 rounded-full text-base font-semibold hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-all">
                    Upload Files
                  </button>
                </SignInButton>
              </SignedOut>
            </div>
          </div>

          {/* Right column - Upload Card */}
          <div
            className="relative rounded-3xl border border-[var(--border)] bg-[rgba(255,255,255,0.08)] backdrop-blur-2xl p-1 shadow-2xl"
            style={{ animation: "fadeUp 0.8s 0.2s ease both" }}
          >
            {/* macOS dots */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)] animate-[float_6s_ease-in-out_infinite]">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" />
              <span className="ml-4 text-xs text-[var(--muted)]">flock — upload</span>
            </div>

            {/* Drop zone */}
            <div
              className={`drop-zone m-4 rounded-2xl border-2 border-dashed p-10 transition-all text-center ${
                dragOver
                  ? "border-[var(--violet)] bg-[rgba(124,111,255,0.08)]"
                  : "border-[rgba(255,255,255,0.1)] hover:border-[var(--violet)] hover:bg-[rgba(124,111,255,0.04)]"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); selectFile(e.dataTransfer.files[0]); }}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />

              {/* Idle state */}
              {status === "idle" && !file && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-[rgba(124,111,255,0.12)] flex items-center justify-center text-3xl mb-2">
                    🕊
                  </div>
                  <p className="text-lg font-semibold text-[var(--text)]">Drop your files anywhere</p>
                  <p className="text-sm text-[var(--muted)]">or <span className="text-[var(--violet2)] font-medium">browse</span> to upload</p>
                  <div className="flex gap-2 mt-3">
                    {[".zip", ".mp4", ".pdf", ".png", ".any"].map((t) => (
                      <span key={t} className="text-[10px] px-2 py-1 rounded-full bg-[rgba(255,255,255,0.05)] text-[var(--muted)] border border-[var(--border)]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* File selected, idle */}
              {status === "idle" && file && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-3 text-left w-full">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(124,111,255,0.15)] flex items-center justify-center text-lg shrink-0">📄</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-[var(--muted)]">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <button
                    className="w-full py-3 rounded-xl bg-[var(--grad)] text-white text-sm font-bold hover:shadow-[0_12px_40px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
                    onClick={(e) => { e.stopPropagation(); sendFile(); }}
                    disabled={busy}
                  >
                    Upload & Get Code
                  </button>
                </div>
              )}

              {/* Working state */}
              {status === "working" && (
                <div className="flex flex-col gap-4 text-left">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(124,111,255,0.15)] flex items-center justify-center text-lg shrink-0 animate-[enc-pulse_2s_infinite]">🔐</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file?.name}</p>
                      <p className="text-xs text-[var(--muted)]">{statusMsg}</p>
                      <div className="h-1 mt-2 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--grad)] transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[var(--muted)] mt-1">{pct}%</p>
                    </div>
                  </div>
                  {shareCode && (
                    <div
                      className="flex items-center w-full rounded-xl bg-[rgba(124,111,255,0.08)] border border-[rgba(124,111,255,0.25)] overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="flex-1 px-4 py-3 text-sm font-mono text-[var(--violet2)] tracking-wider">{shareCode}</span>
                      <button
                        className="px-4 py-3 bg-[var(--grad)] text-white text-xs font-semibold hover:opacity-80 transition-opacity"
                        onClick={copyCode}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Success state */}
              {status === "success" && (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-[rgba(40,200,64,0.15)] border-2 border-[rgba(40,200,64,0.4)] flex items-center justify-center text-2xl text-green-400">
                    ✓
                  </div>
                  <p className="text-lg font-bold">Your share code</p>
                  <div className="flex items-center w-full rounded-xl bg-[rgba(124,111,255,0.08)] border border-[rgba(124,111,255,0.25)] overflow-hidden">
                    <span className="flex-1 px-4 py-3 text-sm font-mono text-[var(--violet2)] tracking-wider">{shareCode}</span>
                    <button
                      className="px-4 py-3 bg-[var(--grad)] text-white text-xs font-semibold hover:opacity-80 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); copyCode(); }}
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <div className="flex gap-3 text-[10px] text-[var(--muted)]">
                    <span>🔒 256-bit encrypted</span>
                    <span>⏱ Auto-expires</span>
                  </div>
                  <button
                    className="mt-2 text-sm text-[var(--violet2)] hover:text-[var(--text)] transition-colors"
                    onClick={(e) => { e.stopPropagation(); setFile(null); setStatus("idle"); setShareCode(""); setProgress(0); }}
                  >
                    Upload another →
                  </button>
                </div>
              )}

              {/* Error state */}
              {status === "error" && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-red-400">{statusMsg}</p>
                  {!isSignedIn ? (
                    <SignInButton mode="modal">
                      <button className="px-4 py-2 rounded-xl bg-[var(--grad)] text-white text-sm font-bold hover:opacity-85 transition-opacity">
                        Sign In to Upload
                      </button>
                    </SignInButton>
                  ) : (
                    <button
                      className="text-sm text-[var(--violet2)] hover:text-[var(--text)] transition-colors"
                      onClick={(e) => { e.stopPropagation(); setStatus("idle"); }}
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
            </div>


          </div>
        </div>
      </section>

      {/* ─── MARQUEE ─── */}
      <section className="relative z-10 py-10 border-y border-[var(--border)] overflow-hidden">
        <div className="flex animate-[marquee_30s_linear_infinite]" style={{ width: "max-content" }}>
          {[...marqueeItems, ...marqueeItems].map((item, i) => (
            <span key={i} className="mx-8 text-sm font-medium text-[var(--muted)] whitespace-nowrap flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-[var(--violet)]" />
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ─── FEATURES BENTO ─── */}
      <section id="features" className="relative z-10 py-28 px-6 md:px-14 max-w-7xl mx-auto">
        <div className="reveal mb-16">
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--violet2)] mb-4">Why choose flock</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-5">
            Everything you need.<br /><em className="italic font-light">Nothing you don&apos;t.</em>
          </h2>
          <p className="text-base text-[var(--muted)] max-w-md">
            Forget clunky UIs and paywalls. Flock is frictionless, fast, and privacy-first.
          </p>
        </div>

        {/* Bento Grid - 12 columns */}
        <div className="reveal grid grid-cols-12 gap-5">

          {/* Card 2 - Encryption (col-span-6) */}
          <div
            className="col-span-12 md:col-span-6 relative group rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-8 transition-all duration-300 overflow-hidden"
            onMouseMove={handleTilt}
            onMouseLeave={handleTiltLeave}
          >
            <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,rgba(0,217,255,0.08),transparent_70%)]" />
            <h3 className="text-base font-bold mb-1 tracking-tight">End-to-end encrypted</h3>
            <p className="text-sm text-[var(--muted)] mb-6">Zero-knowledge architecture. Even we can&apos;t read your files.</p>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(0,217,255,0.05)] border border-[rgba(0,217,255,0.15)] animate-[pulse_4s_infinite]">
                <span className="text-lg">📁</span>
                <div>
                  <p className="text-xs font-bold">RAW</p>
                  <p className="text-[10px] text-[var(--muted)]">Your original file</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(0,217,255,0.05)] border border-[rgba(0,217,255,0.15)] animate-[pulse_4s_0.5s_infinite]">
                <span className="text-lg">🔐</span>
                <div>
                  <p className="text-xs font-bold">LOCAL</p>
                  <p className="text-[10px] text-[var(--muted)]">Encrypted in browser</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(0,217,255,0.05)] border border-[rgba(0,217,255,0.15)] animate-[pulse_4s_1s_infinite]">
                <span className="text-lg">☁️</span>
                <div>
                  <p className="text-xs font-bold">SAFE</p>
                  <p className="text-[10px] text-[var(--muted)]">Stored encrypted</p>
                </div>
              </div>
            </div>
          </div>

          {/* Card 6 - Global Availability (col-span-6) */}
          <div
            className="col-span-12 md:col-span-6 relative group rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-8 transition-all duration-300 overflow-hidden"
            onMouseMove={handleTilt}
            onMouseLeave={handleTiltLeave}
          >
            <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,rgba(0,217,255,0.08),transparent_70%)]" />
            <p className="text-[11px] font-bold tracking-[0.1em] uppercase text-[var(--violet2)] mb-2">Global Availability</p>
            <h3 className="text-base font-bold mb-1 tracking-tight">Always available, everywhere</h3>
            <p className="text-sm text-[var(--muted)] mb-6">Your files are ready the moment you need them, no matter where you are.</p>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(0,217,255,0.05)] border border-[rgba(0,217,255,0.15)]">
                <span className="text-lg">🌍</span>
                <div>
                  <p className="text-xs font-bold">Global Reach</p>
                  <p className="text-[10px] text-[var(--muted)]">Served from 300+ cities worldwide</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(0,217,255,0.05)] border border-[rgba(0,217,255,0.15)]">
                <span className="text-lg">⚡</span>
                <div>
                  <p className="text-xs font-bold">Instant Access</p>
                  <p className="text-[10px] text-[var(--muted)]">Zero delay when you need a file</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(0,217,255,0.05)] border border-[rgba(0,217,255,0.15)]">
                <span className="text-lg">🛡️</span>
                <div>
                  <p className="text-xs font-bold">Highly Reliable</p>
                  <p className="text-[10px] text-[var(--muted)]">Built-in redundancy, never lost</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="how" className="relative z-10 py-28 px-6 md:px-14 max-w-7xl mx-auto">
        <div className="reveal text-center mb-16">
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--violet2)] mb-4">How it works</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">Four steps to <em className="italic font-light">total</em> freedom.</h2>
        </div>
        <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative">
          {/* Connecting line */}
          <div className="hidden lg:block absolute top-8 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-[var(--violet)] to-transparent" />
          {steps.map((s, i) => (
            <div key={i} className="text-center relative z-10">
              <div className="w-16 h-16 rounded-full border border-[rgba(124,111,255,0.3)] bg-[var(--bg2)] flex items-center justify-center mx-auto mb-5 relative">
                {/* Conic gradient progress ring */}
                <div
                  className="absolute inset-[-3px] rounded-full"
                  style={{
                    background: `conic-gradient(var(--violet) ${s.pct}%, transparent ${s.pct}%)`,
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px))",
                    WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #fff calc(100% - 3px))",
                  }}
                />
                <span className="text-xl font-extrabold grad-text">{s.num}</span>
              </div>
              <h4 className="text-sm font-bold mb-2">{s.title}</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" className="relative z-10 py-28 px-6 md:px-14 max-w-5xl mx-auto">
        <div className="reveal text-center mb-16">
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--violet2)] mb-4">Pricing</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-5">Simple, honest pricing</h2>
          <p className="text-base text-[var(--muted)]">Start free. Upgrade when you need more.</p>
        </div>
        <div className="reveal grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Free */}
          <div
            className="price-card rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-8 transition-all duration-300"
            onMouseMove={handleTilt}
            onMouseLeave={handleTiltLeave}
          >
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-5">Free</p>
            <div className="text-5xl font-extrabold tracking-tight mb-1">$0</div>
            <p className="text-sm text-[var(--muted)] mb-7">forever, no card needed</p>
            <div className="h-px bg-[var(--border)] mb-7" />
            <div className="flex flex-col gap-3 mb-8 text-sm text-[var(--muted)]">
              <span>✦ 1 GiB per file</span>
              <span>✦ 7-day expiry</span>
              <span>✦ 10 transfers/month</span>
              <span>✦ Basic encryption</span>
            </div>
            <button className="w-full py-3 rounded-xl border border-[rgba(124,111,255,0.3)] text-sm font-semibold hover:bg-[rgba(124,111,255,0.1)] transition-colors">
              Get started free
            </button>
          </div>

          {/* Pro - Featured */}
          <div className="relative">
            {/* Radial glow blob behind Pro card */}
            <div className="absolute -inset-4 rounded-3xl bg-[radial-gradient(circle,rgba(124,111,255,0.2),transparent_70%)] blur-xl pointer-events-none" />
            <div
              className="price-card relative rounded-3xl bg-[var(--grad)] p-8 transition-all duration-300 scale-[1.03]"
              onMouseMove={handleTilt}
              onMouseLeave={handleTiltLeave}
            >
              {/* Most Popular badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-white text-[var(--violet)] text-[10px] font-bold uppercase tracking-wider shadow-lg">
                Most Popular
              </div>
              <p className="text-xs font-semibold tracking-widest uppercase text-white/70 mb-5">Pro</p>
              <div className="text-5xl font-extrabold tracking-tight text-white mb-1">$8</div>
              <p className="text-sm text-white/60 mb-7">per month, billed monthly</p>
              <div className="h-px bg-white/20 mb-7" />
              <div className="flex flex-col gap-3 mb-8 text-sm text-white/85">
                <span>✦ Unlimited file size</span>
                <span>✦ 30-day expiry</span>
                <span>✦ Unlimited transfers</span>
                <span>✦ E2E encryption</span>
                <span>✦ Password protection</span>
                <span>✦ Download analytics</span>
              </div>
              <button className="w-full py-3 rounded-xl bg-white text-[var(--violet)] text-sm font-bold hover:opacity-90 transition-opacity">
                Start Pro trial
              </button>
            </div>
          </div>

          {/* Team */}
          <div
            className="price-card rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-8 transition-all duration-300"
            onMouseMove={handleTilt}
            onMouseLeave={handleTiltLeave}
          >
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-5">Team</p>
            <div className="text-5xl font-extrabold tracking-tight mb-1">$24</div>
            <p className="text-sm text-[var(--muted)] mb-7">per month, up to 10 users</p>
            <div className="h-px bg-[var(--border)] mb-7" />
            <div className="flex flex-col gap-3 mb-8 text-sm text-[var(--muted)]">
              <span>✦ Everything in Pro</span>
              <span>✦ Team workspace</span>
              <span>✦ Custom domain</span>
              <span>✦ SSO & audit logs</span>
            </div>
            <button className="w-full py-3 rounded-xl border border-[rgba(124,111,255,0.3)] text-sm font-semibold hover:bg-[rgba(124,111,255,0.1)] transition-colors">
              Contact sales
            </button>
          </div>
        </div>
      </section>

      {/* ─── CTA STRIP ─── */}
      <section className="relative z-10 mx-6 md:mx-14 mb-24">
        <div className="reveal rounded-3xl bg-gradient-to-br from-[rgba(124,111,255,0.15)] to-[rgba(0,217,255,0.1)] border border-[rgba(124,111,255,0.3)] p-10 md:p-16 flex flex-col md:flex-row items-center justify-between gap-10 overflow-hidden relative">
          <div className="absolute -top-16 -right-10 w-72 h-72 rounded-full bg-[radial-gradient(circle,rgba(124,111,255,0.2),transparent_70%)] pointer-events-none" />
          <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight text-[var(--text)]">
            Ready to fly?<br />
            <span className="grad-text">Start sharing</span>{" "}
            <em className="italic font-light">free.</em>
          </h2>
          <div className="flex flex-col items-center md:items-end gap-3 shrink-0">
            <button
              className="bg-white text-[var(--violet)] px-8 py-4 rounded-full text-base font-bold hover:shadow-[0_20px_60px_rgba(0,0,0,0.2)] hover:-translate-y-0.5 transition-all"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload your first file
            </button>
            <span className="text-xs text-[var(--muted)]">No account needed · Takes 10 seconds</span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="relative z-10 border-t border-[var(--border)] px-6 md:px-14 py-16">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-lg font-bold">
              <span>🕊</span>
              <span className="grad-text">flock</span>
            </div>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Share files freely. End-to-end encrypted, no sign-up required.
            </p>
          </div>

          {/* Product */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-1">Product</p>
            <a href="#pricing" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Pricing</a>
            <a href="#" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Changelog</a>
            <a href="#" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Status</a>
          </div>

          {/* Developers */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-1">Developers</p>
            <a href="https://github.com/SS-shareapp/test--name--shareapp-" target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Open source</a>
          </div>

          {/* Company */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-1">Company</p>
            <a href="#" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">About</a>
            <a href="#" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Privacy</a>
          </div>
        </div>

        {/* Bottom row */}
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted)]">© 2025 Flock, Inc. All rights reserved.</p>
          <p className="text-xs text-[var(--muted)]">Made by Siddhant & Sanman</p>
          <div className="flex gap-6 text-xs text-[var(--muted)]">
            <a href="#" className="hover:text-[var(--text)] transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-[var(--text)] transition-colors">Cookie Policy</a>
          </div>
        </div>
      </footer>
    </>
  );
}
