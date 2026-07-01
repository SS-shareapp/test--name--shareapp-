"use client";

import { useState } from "react";
import { decryptChunk, keyFromCode } from "@/lib/browser-crypto";
import { formatBytes } from "@/lib/utils";
import Nav from "../components/Nav";
import BrandMark from "../components/BrandMark";

type ReceiveManifest = {
  code: string;
  files: Array<{
    fileId: string;
    filename: string;
    sizeBytes: number;
    chunkSize: number;
    chunkCount: number;
    fileSha256: string;
    salt: string;
    completed: boolean;
    chunks: Array<{ idx: number; getUrl: string }>;
  }>;
};

export default function ReceivePage() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; url: string } | null>(null);

  const pct = Math.round(progress * 100);

  async function receiveFile() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setStatus("working");
    setProgress(0);
    setFileInfo(null);
    try {
      setMsg("Looking up code...");
      const res = await fetch(`/api/receive/${encodeURIComponent(trimmed)}`);
      const data = (await res.json()) as ReceiveManifest | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Not found");
      const target = data.files[0];
      if (!target) throw new Error("No files found");
      if (!target.completed) throw new Error("Upload not finished yet");
      const key = await keyFromCode(trimmed, target.salt);
      const parts: Blob[] = [];
      for (const chunk of target.chunks) {
        setMsg(`Downloading & decrypting ${chunk.idx + 1}/${target.chunkCount}`);
        const dl = await fetch(chunk.getUrl);
        if (!dl.ok) throw new Error(`Chunk ${chunk.idx + 1} failed`);
        parts.push(await decryptChunk(await dl.blob(), chunk.idx, key));
        setProgress((chunk.idx + 1) / target.chunkCount);
      }
      const blob = new Blob(parts);
      setFileInfo({ name: target.filename, size: target.sizeBytes, url: URL.createObjectURL(blob) });
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setMsg(e instanceof Error ? e.message : "Download failed");
    }
  }

  function downloadFile() {
    if (!fileInfo) return;
    const a = document.createElement("a");
    a.href = fileInfo.url;
    a.download = fileInfo.name;
    a.click();
  }

  return (
    <>
      <Nav />
      <main className="relative z-10 min-h-screen flex items-center justify-center px-6 py-24">
        <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--glass)] backdrop-blur-xl p-10 text-center">
          {/* Icon */}
          <div className="w-20 h-20 mx-auto mb-7 rounded-full bg-gradient-to-br from-[rgba(124,111,255,0.2)] to-[rgba(0,217,255,0.15)] border-2 border-[rgba(124,111,255,0.3)] flex items-center justify-center text-4xl animate-[float_4s_ease-in-out_infinite]">
            <BrandMark className="h-10 w-10" />
          </div>

          {/* Idle */}
          {status === "idle" && (
            <>
              <h2 className="text-3xl font-extrabold tracking-tight mb-3">
                Someone sent<br />you a file
              </h2>
              <p className="text-sm text-[var(--muted)] mb-8">
                Enter the share code to download your encrypted file.
              </p>
              <input
                className="w-full px-5 py-4 rounded-xl bg-[rgba(124,111,255,0.06)] border border-[rgba(124,111,255,0.25)] text-center text-lg font-semibold tracking-widest uppercase text-[var(--text)] placeholder:text-[var(--muted)] placeholder:font-normal placeholder:tracking-normal placeholder:normal-case focus:border-[var(--violet)] focus:bg-[rgba(124,111,255,0.1)] transition-all mb-4"
                type="text"
                placeholder="Enter code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={12}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="w-full py-4 rounded-xl bg-[var(--grad)] text-white font-bold text-base hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50"
                onClick={receiveFile}
                disabled={!code.trim()}
              >
                ⬇ Download File
              </button>
            </>
          )}

          {/* Working */}
          {status === "working" && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight mb-6">Downloading...</h2>
              <div className="w-full">
                <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden mb-3">
                  <div
                    className="h-full rounded-full bg-[var(--grad)] transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-[var(--muted)]">{msg} — {pct}%</p>
              </div>
            </>
          )}

          {/* Success */}
          {status === "success" && fileInfo && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight mb-3">Ready to download</h2>
              <p className="text-sm text-[var(--muted)] mb-6">Your file has been decrypted and is ready.</p>
              <div className="flex items-center gap-4 rounded-xl bg-[rgba(124,111,255,0.06)] border border-[rgba(124,111,255,0.2)] p-4 mb-6 text-left">
                <span className="text-3xl">📄</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{fileInfo.name}</p>
                  <p className="text-xs text-[var(--muted)]">{formatBytes(fileInfo.size)}</p>
                </div>
              </div>
              <button
                className="w-full py-4 rounded-xl bg-[var(--grad)] text-white font-bold text-base hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-all"
                onClick={downloadFile}
              >
                ⬇ Save File
              </button>
              <p className="text-xs text-[var(--muted)] mt-4 flex items-center justify-center gap-1.5">
                🔒 Encrypted with AES-256 · Shared via Flock
              </p>
            </>
          )}

          {/* Error */}
          {status === "error" && (
            <>
              <h2 className="text-2xl font-extrabold tracking-tight mb-3">Something went wrong</h2>
              <p className="text-sm text-red-400 mb-6">{msg}</p>
              <button
                className="w-full py-4 rounded-xl bg-[var(--grad)] text-white font-bold text-base hover:shadow-[0_20px_60px_rgba(124,111,255,0.4)] hover:-translate-y-0.5 transition-all"
                onClick={() => setStatus("idle")}
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
