"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  KeyRound,
  Lock,
  Moon,
  Send,
  Shield,
  Sun,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CHUNK_SIZE, MAX_FILE_BYTES } from "@/lib/constants";
import {
  decryptChunk,
  encryptChunk,
  keyFromCode,
  randomSalt,
  sha256Hex,
} from "@/lib/browser-crypto";

type UploadChunk = {
  idx: number;
  putUrl: string;
};

type CreateShareResponse = {
  code: string;
  fileId: string;
  chunkSize: number;
  chunkCount: number;
  expiresAt: string;
  chunks: UploadChunk[];
};

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

type Mode = "send" | "receive";

export default function Home(): React.ReactElement {
  const [mode, setMode] = useState<Mode>("send");
  const [file, setFile] = useState<File | null>(null);
  const [receiveCode, setReceiveCode] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressLabel = useMemo(() => `${Math.round(progress * 100)}%`, [progress]);

  // Theme init
  useEffect(() => {
    const saved = localStorage.getItem("shareapp-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved === "dark" || (!saved && prefersDark) ? "dark" : "light";
    setTheme(initial);
    const html = document.documentElement;
    html.classList.remove("light-theme", "dark-theme");
    html.classList.add(initial === "dark" ? "dark-theme" : "light-theme");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      const html = document.documentElement;
      html.classList.remove("light-theme", "dark-theme");
      html.classList.add(next === "dark" ? "dark-theme" : "light-theme");
      localStorage.setItem("shareapp-theme", next);
      return next;
    });
  }, []);

  // Drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (busy) return;
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) setFile(dropped);
    },
    [busy]
  );

  async function authenticatedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response> {
    return fetch(input, { ...init });
  }

  async function sendFile(): Promise<void> {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Files are limited to 1 GiB.");
      return;
    }

    setBusy(true);
    setError("");
    setShareCode("");
    setProgress(0);

    try {
      setStatus("Hashing file");
      const salt = randomSalt();
      const fileSha256 = await sha256Hex(file);

      setStatus("Creating share code");
      const createResponse = await authenticatedFetch("/api/shares", {
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
      const created = (await createResponse.json()) as
        | CreateShareResponse
        | { error: string };
      if (!createResponse.ok || "error" in created) {
        throw new Error(
          "error" in created ? created.error : "Unable to create share"
        );
      }

      setShareCode(created.code);
      const key = await keyFromCode(created.code, salt);

      for (const chunk of created.chunks) {
        const start = chunk.idx * created.chunkSize;
        const plainChunk = file.slice(
          start,
          Math.min(start + created.chunkSize, file.size)
        );
        setStatus(`Encrypting chunk ${chunk.idx + 1} of ${created.chunkCount}`);
        const encrypted = await encryptChunk(plainChunk, chunk.idx, key);

        setStatus(`Uploading chunk ${chunk.idx + 1} of ${created.chunkCount}`);
        const uploadResponse = await fetch(chunk.putUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: encrypted,
        });
        if (!uploadResponse.ok) {
          throw new Error(`R2 upload failed for chunk ${chunk.idx + 1}`);
        }

        await authenticatedFetch(
          `/api/files/${created.fileId}/chunks/${chunk.idx}`,
          { method: "PUT" }
        );
        setProgress((chunk.idx + 1) / created.chunkCount);
      }

      const completeResponse = await authenticatedFetch(
        `/api/files/${created.fileId}/complete`,
        { method: "POST" }
      );
      if (!completeResponse.ok) {
        throw new Error("Uploaded chunks but could not mark the file complete");
      }
      setStatus("Upload complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
      setStatus("Ready");
    } finally {
      setBusy(false);
    }
  }

  async function receiveFile(): Promise<void> {
    const code = receiveCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a share code.");
      return;
    }

    setBusy(true);
    setError("");
    setProgress(0);

    try {
      setStatus("Loading manifest");
      const manifestResponse = await fetch(
        `/api/receive/${encodeURIComponent(code)}`
      );
      const manifest = (await manifestResponse.json()) as
        | ReceiveManifest
        | { error: string };
      if (!manifestResponse.ok || "error" in manifest) {
        throw new Error(
          "error" in manifest ? manifest.error : "Unable to load share"
        );
      }

      const target = manifest.files[0];
      if (!target) {
        throw new Error("No files found for this code");
      }
      if (!target.completed) {
        throw new Error("The sender has not finished uploading this file yet");
      }

      const key = await keyFromCode(code, target.salt);
      const parts: Blob[] = [];
      for (const chunk of target.chunks) {
        setStatus(
          `Downloading chunk ${chunk.idx + 1} of ${target.chunkCount}`
        );
        const downloadResponse = await fetch(chunk.getUrl);
        if (!downloadResponse.ok) {
          throw new Error(`R2 download failed for chunk ${chunk.idx + 1}`);
        }
        setStatus(
          `Decrypting chunk ${chunk.idx + 1} of ${target.chunkCount}`
        );
        parts.push(
          await decryptChunk(
            await downloadResponse.blob(),
            chunk.idx,
            key
          )
        );
        setProgress((chunk.idx + 1) / target.chunkCount);
      }

      const blob = new Blob(parts);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = target.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("Download complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Download failed");
      setStatus("Ready");
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(shareCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span>Shareapp</span>
        </div>
        <div className="auth">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="stage">
          <div className="headline">
            <h1>Encrypted file transfer by code.</h1>
            <p>
              Send up to 1 GiB through Cloudflare R2. Files are encrypted in
              the browser before upload and unlocked by the receiver&apos;s
              share code.
            </p>
          </div>
          <div className="rail" aria-label="Transfer properties">
            <div className="rail-item">
              <strong>01</strong>
              <span>
                Browser-side encryption keeps file bytes opaque to the app
                server.
              </span>
            </div>
            <div className="rail-item">
              <strong>02</strong>
              <span>
                Vercel issues short metadata responses and R2 presigned URLs
                only.
              </span>
            </div>
            <div className="rail-item">
              <strong>03</strong>
              <span>
                Receiver enters the code, downloads chunks from R2, then
                decrypts locally.
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="tabs" role="tablist" aria-label="Transfer mode">
            <button
              className={`tab ${mode === "send" ? "active" : ""}`}
              onClick={() => setMode("send")}
            >
              Send
            </button>
            <button
              className={`tab ${mode === "receive" ? "active" : ""}`}
              onClick={() => setMode("receive")}
            >
              Receive
            </button>
          </div>

          {mode === "send" ? (
            <div className="form">
              {/* Drag & Drop Zone */}
              <div
                className={`dropzone ${dragActive ? "drag-active" : ""} ${file ? "has-file" : ""}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="dropzone-input"
                  disabled={busy}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <div className="dropzone-icon">
                  {file ? <Check size={24} /> : <Upload size={24} />}
                </div>
                <div className="dropzone-text">
                  {file ? file.name : "Drag & drop or click to browse"}
                </div>
                <div className="dropzone-hint">
                  {file
                    ? `${formatSize(file.size)} selected`
                    : "Max 1 GiB · All file types supported"}
                </div>
              </div>

              <button
                className="primary"
                disabled={busy || !file}
                onClick={sendFile}
              >
                <ArrowUpFromLine size={18} />
                {busy ? "Sending…" : "Send file"}
              </button>

              {shareCode ? (
                <div className="code">
                  <div>
                    <span className="muted">Share code</span>
                    <br />
                    <strong>{shareCode}</strong>
                  </div>
                  <button
                    className="secondary"
                    onClick={copyCode}
                    title="Copy code"
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                    {copied ? "Copied!" : ""}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="form">
              <label className="label">
                Share code
                <input
                  className="input"
                  value={receiveCode}
                  disabled={busy}
                  placeholder="ABCD234XYZ"
                  onChange={(event) =>
                    setReceiveCode(event.target.value.toUpperCase())
                  }
                />
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={receiveFile}
              >
                <ArrowDownToLine size={18} />
                Download file
              </button>
            </div>
          )}

          <div className="form" style={{ marginTop: 24 }}>
            <div className="progress" aria-label={progressLabel}>
              <span
                style={
                  { "--progress": progressLabel } as React.CSSProperties
                }
              />
            </div>
            <div className={`status ${error ? "error" : ""}`}>
              {error || status}
              <br />
              <span className="muted">{progressLabel}</span>
            </div>
            <div className="status">
              <Lock size={16} /> AES-GCM chunks
              <br />
              <KeyRound size={16} /> Key derived from the share code
              <br />
              <Send size={16} /> Direct browser-to-R2 transfer
              <br />
              <Check size={16} /> 1 GiB enforced
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
