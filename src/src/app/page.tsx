"use client";

import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CHUNK_SIZE, MAX_FILE_BYTES } from "@/lib/constants";
import { encryptChunk, keyFromCode, randomSalt, sha256Hex } from "@/lib/browser-crypto";
import { formatBytes } from "@/lib/utils";
import Nav from "./components/Nav";
import BrandMark from "./components/BrandMark";
import Link from "next/link";
import { ArrowUpRight, Upload, File, LockKeyhole, KeyRound, Clock3, Download, ShieldCheck } from "lucide-react";

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
    if (!f || busy) return;
    if (f.size > MAX_FILE_BYTES) {
      setStatus("error");
      setStatusMsg("File exceeds 1 GiB limit.");
      return;
    }
    setFile(f);
    setShareCode("");
    setStatus("idle");
    setCopied(false);
    setStatusMsg("");
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
      setStatusMsg("");
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setStatusMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(shareCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatusMsg("Copy unavailable. Select the code and copy it manually.");
    }
  }

  return (
    <>
      <Nav />

      {/* ─── HERO ─── */}
      <section id="send" className="hero relative z-10 min-h-screen flex items-center pt-24 pb-20 px-6 md:px-14">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left column */}
          <div className="flex flex-col gap-6" style={{ animation: "fadeUp 0.8s ease both" }}>
            <p className="eyebrow"><span className="status-dot" /> A little code. A lot of possibility.</p>
            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] tracking-tight">
              Share files<br />
              <span className="grad-text">keep it simple.</span>
            </h1>

            <p className="text-base md:text-lg text-[var(--muted)] max-w-md leading-relaxed">
              From your browser to theirs. Drop a file, share the code, and let Flock take care of the rest.
            </p>

            <div className="flex items-center gap-3 mt-2">
              <SignedIn>
                <button
                  className="primary-action bg-[var(--grad)] text-white px-7 py-3.5 rounded-full text-base font-semibold hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-[transform,opacity,box-shadow] disabled:opacity-50"
                  onClick={file ? sendFile : () => fileInputRef.current?.click()}
                  disabled={busy || status === "working"}
                >
                  {status === "working" ? "Uploading\u2026" : "Send a file"}
                </button>
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="primary-action bg-[var(--grad)] text-white px-7 py-3.5 rounded-full text-base font-semibold hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-[transform,opacity,box-shadow]">
                    Send a file
                  </button>
                </SignInButton>
              </SignedOut>
              <Link href="/receive" className="secondary-action">Receive a file <ArrowUpRight size={17} /></Link>
            </div>
            <p className="hero-note"><ShieldCheck size={16} /> Encrypted in your browser <span>·</span> Up to 1 GiB</p>
          </div>

          {/* Right column - Upload Card */}
          <div
            className="upload-panel relative rounded-3xl border border-[var(--border)]"
            style={{ animation: "fadeUp 0.8s 0.2s ease both" }}
          >
            <div className="upload-panel-heading">
              <span><Upload size={18} /> Send a file</span>
              <span className="private-label"><LockKeyhole size={12} /> Private transfer</span>
            </div>

            {/* Drop zone */}
            <div
              className={`drop-zone m-4 rounded-2xl border-2 border-dashed p-10 transition-all text-center ${
                dragOver
                  ? "border-[var(--violet)] bg-[rgba(124,111,255,0.08)] shadow-[inset_0_0_50px_rgba(124,111,255,0.2)]"
                  : "border-[rgba(255,255,255,0.1)] hover:border-[var(--violet)] hover:bg-[rgba(124,111,255,0.04)]"
              }`}
              role="region"
              aria-label="File upload"
              onClick={() => { if (!busy && status === "idle") fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
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
                    <Upload className="h-7 w-7" />
                  </div>
                  <p className="text-lg font-semibold text-[var(--text)]">Drop your file here</p>
                  <p className="text-sm text-[var(--muted)]">or choose one from your device</p>
                  <button type="button" className="browse-button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse files <ArrowUpRight size={16} /></button>
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
                    <div className="w-10 h-10 rounded-xl bg-[rgba(124,111,255,0.15)] flex items-center justify-center text-lg shrink-0">{<File size={23} />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-[var(--muted)]">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <button
                    className="w-full py-3 rounded-xl bg-[var(--grad)] text-white text-sm font-bold hover:shadow-[0_12px_40px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-[transform,opacity,box-shadow] disabled:opacity-50"
                    onClick={(e) => { e.stopPropagation(); sendFile(); }}
                    disabled={busy}
                  >
                    Upload & Get Code
                  </button>
                  <button type="button" className="text-xs text-[var(--muted)] underline underline-offset-4" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>Choose a different file</button>
                </div>
              )}

              {/* Working state */}
              {status === "working" && (
                <div className="flex flex-col gap-4 text-left" aria-live="polite" aria-atomic="true">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(124,111,255,0.15)] flex items-center justify-center text-lg shrink-0 animate-[enc-pulse_2s_infinite]">{<LockKeyhole size={23} />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{file?.name}</p>
                      <p className="text-xs text-[var(--muted)]">{statusMsg}</p>
                      <div className="h-1 mt-2 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--grad)] transition-[width] duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[var(--muted)] mt-1 tabular-nums">{pct}%</p>
                    </div>
                  </div>

                </div>
              )}

              {/* Success state */}
              {status === "success" && (
                <div className="flex flex-col items-center gap-4" aria-live="assertive">
                  <div className="w-16 h-16 rounded-full bg-[rgba(40,200,64,0.15)] border-2 border-[rgba(40,200,64,0.4)] flex items-center justify-center text-2xl text-green-400">
                    ✓
                  </div>
                  <p className="text-lg font-bold">Ready to share</p>
                  <p className="text-sm text-[var(--muted)]">Send this code to your recipient.</p>
                  <div className="flex items-center w-full rounded-xl bg-[rgba(124,111,255,0.08)] border border-[rgba(124,111,255,0.25)] overflow-hidden">
                    <span className="select-all min-w-0 flex-1 px-4 py-3 text-sm font-mono text-[var(--violet2)] tracking-wider">{shareCode}</span>
                    <button
                      className="px-4 py-3 bg-[var(--grad)] text-white text-xs font-semibold hover:opacity-80 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); copyCode(); }}
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)]" role="status">{statusMsg.startsWith("Copy unavailable") ? statusMsg : ""}</p>
                  <div className="flex gap-3 text-[10px] text-[var(--muted)]">
                    <span>AES-256 encrypted</span>
                    <span>Auto-expires</span>
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
                <div className="flex flex-col items-center gap-3" role="alert">
                  <p className="text-sm text-red-400">{statusMsg}</p>
                  {!isSignedIn ? (
                    <SignInButton mode="modal">
                      <button onClick={(e) => e.stopPropagation()} className="px-4 py-2 rounded-xl bg-[var(--grad)] text-white text-sm font-bold hover:opacity-85 transition-opacity">
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
            <div className="upload-panel-footer"><span><ShieldCheck size={14} /> Encrypted before it leaves your device</span><span>1 GiB max</span></div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="relative z-10 py-28 px-6 md:px-14 max-w-7xl mx-auto">
        <div className="reveal mb-16">
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--violet2)] mb-4">Why choose flock</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-5">
            Everything you need.<br /><em className="italic font-light">Nothing you don&apos;t.</em>
          </h2>
        </div>

        <div className="reveal grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-10 flex flex-col justify-center min-h-[240px]">
            <span className="text-[var(--violet2)] mb-4 text-2xl"><LockKeyhole size={24} /></span>
            <p className="text-lg font-medium leading-relaxed">Your file never leaves your browser unencrypted.</p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-10 flex flex-col justify-center min-h-[240px]">
            <span className="text-[var(--violet2)] mb-4 text-2xl"><KeyRound size={24} /></span>
            <p className="text-lg font-medium leading-relaxed">The code is the key. No code, no file.</p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-10 flex flex-col justify-center min-h-[240px]">
            <span className="text-[var(--violet2)] mb-4 text-2xl"><Clock3 size={24} /></span>
            <p className="text-lg font-medium leading-relaxed">A temporary home for your file. Automatically deleted after expiry.</p>
          </div>
        </div>
      </section>

      {/* ─── THE JOURNEY ─── */}
      <section id="how" className="relative z-10 py-28 px-6 md:px-14 max-w-7xl mx-auto">
        <div className="reveal text-center mb-20">
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--violet2)] mb-4">The journey of your file</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">One file. One code. That’s it.</h2>
        </div>

        <div className="reveal max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 relative">
          <div className="flex flex-col items-center text-center max-w-[200px]">
            <div className="w-16 h-16 rounded-2xl bg-[rgba(124,111,255,0.1)] border border-[rgba(124,111,255,0.2)] flex items-center justify-center text-2xl mb-4">{<File size={23} />}</div>
            <p className="text-sm font-bold mb-1">Local File</p>
            <p className="text-xs text-[var(--muted)]">Select your file</p>
          </div>

          <div className="flex-1 flex items-center justify-center px-4 relative w-full md:w-auto h-24 md:h-auto">
             <div className="absolute inset-0 md:inset-y-auto md:left-0 md:right-0 h-[1px] md:top-1/2 -translate-y-1/2 border-dashed border-b border-[rgba(124,111,255,0.3)]"></div>
             <div className="bg-[var(--bg)] px-4 py-2 rounded-xl border border-[rgba(124,111,255,0.2)] relative z-10 text-[var(--violet2)] font-mono tracking-widest text-lg font-bold shadow-[0_0_30px_rgba(124,111,255,0.2)]">
               A7KH3M9X2P
             </div>
          </div>

          <div className="flex flex-col items-center text-center max-w-[200px]">
            <div className="w-16 h-16 rounded-2xl bg-[rgba(124,111,255,0.1)] border border-[rgba(124,111,255,0.2)] flex items-center justify-center text-2xl mb-4"><Download size={23} /></div>
            <p className="text-sm font-bold mb-1">Decrypted</p>
            <p className="text-xs text-[var(--muted)]">Recipient downloads</p>
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" className="relative z-10 py-28 px-6 md:px-14 max-w-5xl mx-auto">
        <div className="reveal text-center mb-16">
          <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--violet2)] mb-4">Pricing</p>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-5">Simple, honest pricing</h2>
          <p className="text-base text-[var(--muted)]">Start sharing for free. More ways to share are on the way.</p>
        </div>
        <div className="reveal grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Free */}
          <div
            className="price-card rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-8 transition-[transform] duration-300"
          >
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-5">Free</p>
            <div className="text-5xl font-extrabold tracking-tight mb-1">$0</div>
            <p className="text-sm text-[var(--muted)] mb-7">forever, no card needed</p>
            <div className="h-px bg-[var(--border)] mb-7" />
            <div className="flex flex-col gap-3 mb-8 text-sm text-[var(--muted)]">
              <span>✦ 1{"\u00a0"}GiB per file</span>
              <span>✦ Automatic expiry</span>
              <span>✦ Share with a private code</span>
              <span>✦ AES-256 encryption</span>
            </div>
            <a href="#send" className="block w-full py-3 rounded-xl border border-[rgba(124,111,255,0.3)] text-sm font-semibold text-center hover:bg-[rgba(124,111,255,0.1)] transition-colors">
              Get started free
            </a>
          </div>

          {/* Pro - Featured */}
          <div className="relative">
            {/* Radial glow blob behind Pro card */}
            <div className="absolute -inset-4 rounded-3xl bg-[radial-gradient(circle,rgba(124,111,255,0.2),transparent_70%)] blur-xl pointer-events-none" />
            <div
              className="price-card relative rounded-3xl bg-[var(--grad)] p-8 transition-[transform] duration-300 scale-[1.03]"
            >
              {/* Coming soon badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-white text-[var(--violet)] text-[10px] font-bold uppercase tracking-wider shadow-lg">
                Coming soon
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
              <button disabled className="block w-full py-3 rounded-xl bg-white text-[var(--violet)] text-sm font-bold text-center">
                Coming soon
              </button>
            </div>
          </div>

          {/* Team */}
          <div
            className="price-card rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-sm p-8 transition-[transform] duration-300"
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
            <button disabled className="block w-full py-3 rounded-xl border border-[var(--border)] text-sm font-semibold text-center">
              Coming soon
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
              className="bg-white text-[var(--violet)] px-8 py-4 rounded-full text-base font-bold hover:shadow-[0_20px_60px_rgba(0,0,0,0.2)] hover:-translate-y-0.5 transition-[transform,opacity,box-shadow]"
              onClick={() => { document.getElementById("send")?.scrollIntoView({ behavior: "smooth" }); fileInputRef.current?.click(); }}
            >
              Upload your first file
            </button>
            <span className="text-xs text-[var(--muted)]">Sign in to send · No account needed to receive</span>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="relative z-10 border-t border-[var(--border)] px-6 md:px-14 py-16">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-lg font-bold">
              <BrandMark className="h-5 w-5" />
              <span className="grad-text">flock</span>
            </div>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              A simpler way to send. Encrypted in your browser, shared with a code.
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-col gap-3 md:items-end">
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--muted)] mb-1">Resources</p>
            <a href="#pricing" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Pricing</a>
            <a href="https://github.com/SS-shareapp/test--name--shareapp-" target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors">Open source</a>
          </div>
        </div>

        {/* Bottom row */}
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted)]">© 2025 Flock, Inc. All rights reserved.</p>
          <p className="text-xs text-[var(--muted)]">Made by Siddhant & Sanman</p>
        </div>
      </footer>
    </>
  );
}
