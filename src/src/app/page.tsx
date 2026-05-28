"use client";

import { SignedIn, SignedOut, SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CHUNK_SIZE, MAX_FILE_BYTES } from "@/lib/constants";
import { decryptChunk, encryptChunk, keyFromCode, randomSalt, sha256Hex } from "@/lib/browser-crypto";

type UploadChunk = { idx: number; putUrl: string };
type CreateShareResponse = { code: string; fileId: string; chunkSize: number; chunkCount: number; expiresAt: string; chunks: UploadChunk[]; };
type ReceiveManifest = { code: string; files: Array<{ fileId: string; filename: string; sizeBytes: number; chunkSize: number; chunkCount: number; fileSha256: string; salt: string; completed: boolean; chunks: Array<{ idx: number; getUrl: string }>; }>; };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export default function Home(): React.ReactElement {
  const { getToken } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [shareCode, setShareCode] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);

  const [showReceive, setShowReceive] = useState(false);
  const [receiveCode, setReceiveCode] = useState("");
  const [rcvStatus, setRcvStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [rcvMsg, setRcvMsg] = useState("");
  const [rcvProgress, setRcvProgress] = useState(0);
  const [rcvFile, setRcvFile] = useState<{ name: string; size: number; url: string } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Detect system theme on mount + listen for changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const saved = localStorage.getItem("flock-theme");
    const initial = saved ? (saved as "dark" | "light") : (mq.matches ? "light" : "dark");
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);

    function handleChange(e: MediaQueryListEvent) {
      // Only auto-switch if user hasn't manually set a preference
      if (!localStorage.getItem("flock-theme")) {
        const next = e.matches ? "light" : "dark";
        setTheme(next);
        document.documentElement.setAttribute("data-theme", next);
      }
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const pct = useMemo(() => Math.round(progress * 100), [progress]);

  // ── THEME TOGGLE ──
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("flock-theme", next);
  }

  // ── BIRD CANVAS ANIMATION ──
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    // Bird class
    class Bird {
      x: number; y: number; speed: number; size: number;
      wingAngle: number; wingSpeed: number; opacity: number;
      waviness: number; waveOffset: number; baseY: number;

      constructor(init: boolean) {
        this.x = init ? Math.random() * canvas!.width : -80;
        this.y = Math.random() * canvas!.height * 0.75 + 50;
        this.speed = 0.6 + Math.random() * 1.2;
        this.size = 0.5 + Math.random() * 1.2;
        this.wingAngle = Math.random() * Math.PI * 2;
        this.wingSpeed = 0.04 + Math.random() * 0.05;
        this.opacity = 0.15 + Math.random() * 0.5;
        this.waviness = (Math.random() - 0.5) * 0.3;
        this.waveOffset = Math.random() * Math.PI * 2;
        this.baseY = this.y;
      }

      reset() {
        this.x = -80;
        this.y = Math.random() * canvas!.height * 0.75 + 50;
        this.speed = 0.6 + Math.random() * 1.2;
        this.size = 0.5 + Math.random() * 1.2;
        this.wingAngle = Math.random() * Math.PI * 2;
        this.wingSpeed = 0.04 + Math.random() * 0.05;
        this.opacity = 0.15 + Math.random() * 0.5;
        this.waviness = (Math.random() - 0.5) * 0.3;
        this.waveOffset = Math.random() * Math.PI * 2;
        this.baseY = this.y;
      }

      update() {
        this.x += this.speed;
        this.wingAngle += this.wingSpeed;
        this.y = this.baseY + Math.sin(this.x * 0.008 + this.waveOffset) * 18 * this.waviness;
        if (this.x > canvas!.width + 80) this.reset();
      }

      draw(c: CanvasRenderingContext2D) {
        const s = this.size;
        const w = Math.sin(this.wingAngle) * 10 * s;
        const isDark = themeRef.current === "dark";
        c.save();
        c.translate(this.x, this.y);
        c.globalAlpha = this.opacity;
        c.strokeStyle = isDark ? "rgba(200, 190, 255, 1)" : "rgba(108, 99, 255, 0.4)";
        c.lineWidth = 1.2 * s;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(-14 * s, w, -24 * s, w * 0.5);
        c.moveTo(0, 0);
        c.quadraticCurveTo(14 * s, w, 24 * s, w * 0.5);
        c.stroke();
        c.restore();
      }
    }

    const birds = Array.from({ length: 38 }, () => new Bird(true));

    // Stars
    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * 1920, y: Math.random() * 1080,
      r: Math.random() * 1.5, o: Math.random() * 0.3 + 0.05,
      tw: Math.random() * Math.PI * 2, ts: 0.005 + Math.random() * 0.01
    }));

    let animId: number;
    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Radial gradient bg — only in dark mode
      if (themeRef.current === "dark") {
        const grd = ctx!.createRadialGradient(
          canvas!.width * 0.3, canvas!.height * 0.4, 0,
          canvas!.width * 0.5, canvas!.height * 0.5, canvas!.width * 0.8
        );
        grd.addColorStop(0, "rgba(108,99,255,0.06)");
        grd.addColorStop(0.5, "rgba(56,189,248,0.03)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx!.fillStyle = grd;
        ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      }

      // Stars
      stars.forEach(s => {
        s.tw += s.ts;
        const a = s.o * (0.5 + 0.5 * Math.sin(s.tw));
        const isDark = themeRef.current === "dark";
        ctx!.beginPath();
        ctx!.arc(s.x * canvas!.width / 1920, s.y * canvas!.height / 1080, s.r, 0, Math.PI * 2);
        ctx!.fillStyle = isDark ? `rgba(200,190,255,${a})` : `rgba(108,99,255,${a * 0.6})`;
        ctx!.fill();
      });

      // Birds
      birds.forEach(b => { b.update(); b.draw(ctx!); });

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  // ── SCROLL REVEAL ──
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("in"); });
    }, { threshold: 0.15 });
    document.querySelectorAll(".reveal").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // ── API ──
  async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    return fetch(input, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  }

  function selectFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { setStatus("error"); setStatusMsg("File exceeds 1 GiB limit."); return; }
    setFile(f); setShareCode(""); setStatus("idle");
  }

  async function sendFile(): Promise<void> {
    if (!file) return;
    setBusy(true); setStatus("working"); setProgress(0); setShareCode("");
    try {
      setStatusMsg("Hashing...");
      const salt = randomSalt();
      const fileSha256 = await sha256Hex(file);
      setStatusMsg("Creating share...");
      const res = await authFetch("/api/shares", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, sizeBytes: file.size, chunkSize: DEFAULT_CHUNK_SIZE, fileSha256, salt })
      });
      const data = (await res.json()) as CreateShareResponse | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Failed");
      setShareCode(data.code);
      const key = await keyFromCode(data.code, salt);
      for (const chunk of data.chunks) {
        const start = chunk.idx * data.chunkSize;
        const plain = file.slice(start, Math.min(start + data.chunkSize, file.size));
        setStatusMsg(`Uploading ${chunk.idx + 1}/${data.chunkCount}`);
        const enc = await encryptChunk(plain, chunk.idx, key);
        const up = await fetch(chunk.putUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: enc });
        if (!up.ok) throw new Error(`Chunk ${chunk.idx + 1} failed`);
        await authFetch(`/api/files/${data.fileId}/chunks/${chunk.idx}`, { method: "PUT" });
        setProgress((chunk.idx + 1) / data.chunkCount);
      }
      const complete = await authFetch(`/api/files/${data.fileId}/complete`, { method: "POST" });
      if (!complete.ok) throw new Error("Could not finalize");
      setStatus("success");
    } catch (e) { setStatus("error"); setStatusMsg(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  async function receiveFile(): Promise<void> {
    const code = receiveCode.trim().toUpperCase();
    if (!code) return;
    setRcvStatus("working"); setRcvProgress(0); setRcvFile(null);
    try {
      setRcvMsg("Looking up code...");
      const res = await fetch(`/api/receive/${encodeURIComponent(code)}`);
      const data = (await res.json()) as ReceiveManifest | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Not found");
      const target = data.files[0];
      if (!target) throw new Error("No files found");
      if (!target.completed) throw new Error("Upload not finished yet");
      const key = await keyFromCode(code, target.salt);
      const parts: Blob[] = [];
      for (const chunk of target.chunks) {
        setRcvMsg(`Downloading ${chunk.idx + 1}/${target.chunkCount}`);
        const dl = await fetch(chunk.getUrl);
        if (!dl.ok) throw new Error(`Chunk ${chunk.idx + 1} failed`);
        parts.push(await decryptChunk(await dl.blob(), chunk.idx, key));
        setRcvProgress((chunk.idx + 1) / target.chunkCount);
      }
      setRcvFile({ name: target.filename, size: target.sizeBytes, url: URL.createObjectURL(new Blob(parts)) });
      setRcvStatus("success");
    } catch (e) { setRcvStatus("error"); setRcvMsg(e instanceof Error ? e.message : "Download failed"); }
  }

  function downloadRcvFile() { if (!rcvFile) return; const a = document.createElement("a"); a.href = rcvFile.url; a.download = rcvFile.name; a.click(); }
  async function copyCode() { await navigator.clipboard.writeText(shareCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  return (
    <>
      <canvas ref={canvasRef} id="bg-canvas" />

      {/* Sun rays — visible only in light theme */}
      <div className={`sun-rays ${theme === "light" ? "visible" : ""}`} aria-hidden="true">
        <div className="sun-ray-left" />
        <div className="sun-ray-right" />
        <div className="sun-ray-streak-1" />
        <div className="sun-ray-streak-2" />
        <div className="sun-ray-streak-3" />
        <div className="sun-ray-streak-4" />
      </div>

      {/* NAV */}
      <nav>
        <div className="logo">
          <span className="logo-bird">🕊</span>
          <span className="logo-text">Flock</span>
        </div>
        <div className="nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="#pricing" className="nav-link">Pricing</a>
          <a href="#how" className="nav-link">Docs</a>
          <button className="nav-cta" onClick={() => setShowReceive(true)}>Receive a File</button>
        </div>
        <div className="nav-right">
          <SignedOut><SignInButton mode="modal"><button className="nav-cta">Sign in</button></SignInButton></SignedOut>
          <SignedIn><UserButton /></SignedIn>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="glow-orb orb1" />
        <div className="glow-orb orb2" />

        <div className="hero-badge">
          <div className="badge-dot" />
          No account needed · End-to-end encrypted
        </div>

        <h1 className="hero-h1">
          Share files<br /><span className="grad">like a bird.</span>
        </h1>

        <p className="hero-sub">
          Drop your files. Get a link instantly. No sign-up, no limits on file size, no nonsense. Just share and fly.
        </p>

        {/* DROP ZONE */}
        <div
          className={`drop-area ${dragOver ? "drag-over" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); selectFile(e.dataTransfer.files[0]); }}
        >
          <input ref={fileInputRef} type="file" className="sr-only" onChange={(e) => selectFile(e.target.files?.[0] ?? null)} disabled={busy} />

          {/* Default state */}
          {status === "idle" && !file && (
            <div>
              <div className="drop-icon">📁</div>
              <p className="drop-title">Drop your files here</p>
              <p className="drop-sub">or <span>browse to upload</span> · Any file, any size</p>
            </div>
          )}

          {/* File selected */}
          {status === "idle" && file && (
            <div className="upload-progress">
              <div className="file-item">
                <div className="file-icon-box">📄</div>
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-size">{formatSize(file.size)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Uploading */}
          {status === "working" && (
            <div className="upload-progress">
              <div className="file-item">
                <div className="file-icon-box">📄</div>
                <div className="file-info">
                  <div className="file-name">{file?.name}</div>
                  <div className="file-size">{statusMsg}</div>
                  <div className="file-bar-wrap"><div className="file-bar" style={{ width: `${pct}%` }} /></div>
                </div>
              </div>
            </div>
          )}

          {/* Success */}
          {status === "success" && (
            <div className="link-result">
              <div className="link-success-icon">✓</div>
              <p style={{ fontSize: 18, fontWeight: 700 }}>Your link is ready!</p>
              <div className="link-box">
                <div className="link-url">{shareCode}</div>
                <button className="copy-btn" onClick={(e) => { e.stopPropagation(); copyCode(); }}>
                  {copied ? "✓ Copied!" : "Copy"}
                </button>
              </div>
              <p className="link-meta">⏱ 256-bit encrypted · Share this code</p>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "#ef4444", fontSize: 14 }}>{statusMsg}</p>
            </div>
          )}
        </div>

        {/* ACTIONS */}
        <div className="hero-actions">
          <SignedIn>
            {status === "idle" && <button className="btn-primary" onClick={file ? sendFile : () => fileInputRef.current?.click()} disabled={busy}>{file ? "Upload Files" : "Upload Files"}</button>}
            {status === "success" && <button className="btn-primary" onClick={() => { setFile(null); setStatus("idle"); setShareCode(""); setProgress(0); }}>Upload Another</button>}
            {status === "error" && <button className="btn-primary" onClick={() => setStatus("idle")}>Try Again</button>}
            {status === "working" && <button className="btn-primary" disabled>Uploading...</button>}
          </SignedIn>
          <SignedOut><SignInButton mode="modal"><button className="btn-primary">Upload Files</button></SignInButton></SignedOut>
          <button className="btn-ghost" onClick={() => setShowReceive(true)}>I have a link →</button>
        </div>

        {/* STATS */}
        <div className="hero-stats">
          <div className="stat"><div className="stat-n">2.4M+</div><div className="stat-l">Files shared</div></div>
          <div className="stat"><div className="stat-n">∞</div><div className="stat-l">File size limit</div></div>
          <div className="stat"><div className="stat-n">99.9%</div><div className="stat-l">Uptime</div></div>
          <div className="stat"><div className="stat-n">142</div><div className="stat-l">Countries</div></div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features-section" id="features">
        <div className="reveal">
          <p className="section-label">Why Flock</p>
          <h2 className="section-h2">Built for how<br />you actually share</h2>
          <p className="section-sub">Forget clunky UIs and paywalls. Flock is frictionless, fast, and privacy-first.</p>
        </div>
        <div className="features-grid reveal">
          <div className="feat-card feat-card-large">
            <div className="feat-content">
              <div className="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
              <h3 className="feat-title">Instant sharing</h3>
              <p className="feat-desc">Your link is generated the moment upload starts. Share before it&apos;s even finished uploading. No waiting, no queues.</p>
            </div>
            <div className="feat-visual">
              <div className="mini-file"><span className="mini-file-icon">🎬</span><div><div className="mini-file-name">demo_final_v3.mp4</div><div className="mini-file-size">248 MB</div><div className="mini-progress"><div className="mini-progress-fill" style={{ background: "linear-gradient(90deg,#6c63ff,#38bdf8)", width: "72%" }} /></div></div></div>
              <div className="mini-file"><span className="mini-file-icon">🖼</span><div><div className="mini-file-name">brand_assets.zip</div><div className="mini-file-size">56 MB</div><div className="mini-progress"><div className="mini-progress-fill" style={{ background: "linear-gradient(90deg,#6c63ff,#a78bfa)", width: "100%" }} /></div></div></div>
              <div className="mini-link"><span>🔗</span> flock.sh/f/xK9mB2pQ</div>
            </div>
          </div>
          <div className="feat-card"><div className="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><h3 className="feat-title">End-to-end encrypted</h3><p className="feat-desc">Files are encrypted in your browser before they ever leave your device. Even we can&apos;t read them.</p></div>
          <div className="feat-card"><div className="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><h3 className="feat-title">Self-destructing links</h3><p className="feat-desc">Set expiry from 1 hour to 30 days. Add a download limit. Links auto-delete after they expire.</p></div>
          <div className="feat-card"><div className="feat-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div><h3 className="feat-title">Global CDN delivery</h3><p className="feat-desc">Files delivered from 120+ edge nodes worldwide. Blazing fast downloads no matter where your recipient is.</p></div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how-section" id="how">
        <div className="reveal" style={{ textAlign: "center", marginBottom: 72 }}>
          <p className="section-label">How it works</p>
          <h2 className="section-h2">Three steps to freedom</h2>
        </div>
        <div className="how-grid reveal">
          <div className="how-step"><div className="how-num-wrap"><span className="how-n">01</span></div><h4 className="how-title">Drop your file</h4><p className="how-desc">Drag and drop any file, or browse. Any size, any format. No account needed.</p></div>
          <div className="how-step"><div className="how-num-wrap"><span className="how-n">02</span></div><h4 className="how-title">Get your link</h4><p className="how-desc">A unique, encrypted link is generated instantly as your file uploads.</p></div>
          <div className="how-step"><div className="how-num-wrap"><span className="how-n">03</span></div><h4 className="how-title">Share anywhere</h4><p className="how-desc">Send it via WhatsApp, email, Slack — wherever you communicate.</p></div>
          <div className="how-step"><div className="how-num-wrap"><span className="how-n">04</span></div><h4 className="how-title">It self-destructs</h4><p className="how-desc">Links expire automatically. No traces. No leftover files floating on a server.</p></div>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing-section" id="pricing">
        <div className="reveal">
          <p className="section-label">Pricing</p>
          <h2 className="section-h2">Simple, honest pricing</h2>
          <p className="section-sub" style={{ margin: "0 auto" }}>Start free. Upgrade when you need more.</p>
        </div>
        <div className="pricing-grid reveal">
          <div className="price-card">
            <p className="price-tag">Free</p><div className="price-amt">$0</div><p className="price-per">forever, no card needed</p><div className="price-divider" />
            <div className="price-features"><div className="price-feat"><span>✦</span> Up to 2 GB per file</div><div className="price-feat"><span>✦</span> 7-day expiry</div><div className="price-feat"><span>✦</span> 10 transfers/month</div><div className="price-feat"><span>✦</span> Basic encryption</div></div>
            <button className="price-btn">Get started free</button>
          </div>
          <div className="price-card price-card-featured">
            <p className="price-tag">Pro</p><div className="price-amt">$8</div><p className="price-per">per month, billed monthly</p><div className="price-divider" />
            <div className="price-features"><div className="price-feat"><span>✦</span> Unlimited file size</div><div className="price-feat"><span>✦</span> 30-day expiry</div><div className="price-feat"><span>✦</span> Unlimited transfers</div><div className="price-feat"><span>✦</span> E2E encryption</div><div className="price-feat"><span>✦</span> Password protection</div><div className="price-feat"><span>✦</span> Download analytics</div></div>
            <button className="price-btn">Start Pro trial</button>
          </div>
          <div className="price-card">
            <p className="price-tag">Team</p><div className="price-amt">$24</div><p className="price-per">per month, up to 10 users</p><div className="price-divider" />
            <div className="price-features"><div className="price-feat"><span>✦</span> Everything in Pro</div><div className="price-feat"><span>✦</span> Team workspace</div><div className="price-feat"><span>✦</span> Custom domain</div><div className="price-feat"><span>✦</span> SSO & audit logs</div></div>
            <button className="price-btn">Contact sales</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="foot-logo">🕊 <span>Flock</span></div>
        <div className="foot-links"><a href="#" className="foot-link">Privacy</a><a href="#" className="foot-link">Terms</a><a href="#" className="foot-link">Status</a><a href="#" className="foot-link">API</a></div>
        <div className="foot-copy">© 2025 Flock, Inc.</div>
      </footer>

      {/* RECEIVE MODAL */}
      {showReceive && (
        <div className="recv-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowReceive(false); setRcvStatus("idle"); } }}>
          <div className="recv-card">
            <div className="recv-icon">🕊</div>
            {rcvStatus === "idle" && (<>
              <h2 className="recv-h2">Someone sent<br />you a file</h2>
              <p className="recv-sub">Enter the share code to download your encrypted file.</p>
              <input className="recv-input" type="text" placeholder="Enter code" value={receiveCode} onChange={(e) => setReceiveCode(e.target.value.toUpperCase())} maxLength={12} autoComplete="off" spellCheck={false} />
              <button className="recv-btn" onClick={receiveFile} disabled={!receiveCode.trim()}>⬇ Download File</button>
              <button className="recv-cancel" onClick={() => setShowReceive(false)}>Cancel</button>
            </>)}
            {rcvStatus === "working" && (<>
              <h2 className="recv-h2">Downloading...</h2>
              <div className="recv-progress"><div className="recv-bar"><div className="recv-bar-fill" style={{ width: `${Math.round(rcvProgress * 100)}%` }} /></div><p className="recv-bar-label">{rcvMsg}</p></div>
            </>)}
            {rcvStatus === "success" && rcvFile && (<>
              <h2 className="recv-h2">Someone sent<br />you a file</h2>
              <p className="recv-sub">This file is encrypted and ready to download.</p>
              <div className="recv-file-info"><div className="recv-file-icon">📄</div><div><div className="recv-file-name">{rcvFile.name}</div><div className="recv-file-size">{formatSize(rcvFile.size)}</div></div></div>
              <button className="recv-btn" onClick={downloadRcvFile}>⬇ Download File</button>
              <div className="recv-encrypt"><span>🔒</span> Encrypted with AES-256 · Shared via Flock</div>
              <button className="recv-cancel" style={{ marginTop: 16 }} onClick={() => { setShowReceive(false); setRcvStatus("idle"); setReceiveCode(""); setRcvFile(null); }}>Close</button>
            </>)}
            {rcvStatus === "error" && (<>
              <h2 className="recv-h2">Something went wrong</h2>
              <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 16 }}>{rcvMsg}</p>
              <button className="recv-btn" onClick={() => setRcvStatus("idle")}>Try Again</button>
              <button className="recv-cancel" onClick={() => { setShowReceive(false); setRcvStatus("idle"); }}>Cancel</button>
            </>)}
          </div>
        </div>
      )}
      {/* THEME TOGGLE */}
      <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </>
  );
}
