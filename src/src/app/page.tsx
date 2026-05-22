"use client";

import { SignedIn, SignedOut, SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { ArrowDownToLine, ArrowUpFromLine, Copy, Shield, Loader2, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useMemo, useState } from "react";
import { DEFAULT_CHUNK_SIZE, MAX_FILE_BYTES } from "@/lib/constants";
import { decryptChunk, encryptChunk, keyFromCode, randomSalt, sha256Hex } from "@/lib/browser-crypto";

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
  const { getToken } = useAuth();
  const [mode, setMode] = useState<Mode>("send");
  const [file, setFile] = useState<File | null>(null);
  const [receiveCode, setReceiveCode] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const progressLabel = useMemo(() => `${Math.round(progress * 100)}%`, [progress]);

  async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  }

  async function sendFile(): Promise<void> {
    if (!file) {
      toast.error("Choose a file first.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Files are limited to 1 GiB.");
      return;
    }

    setBusy(true);
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
          salt
        })
      });
      const created = (await createResponse.json()) as CreateShareResponse | { error: string };
      if (!createResponse.ok || "error" in created) {
        throw new Error("error" in created ? created.error : "Unable to create share");
      }

      setShareCode(created.code);
      const key = await keyFromCode(created.code, salt);

      for (const chunk of created.chunks) {
        const start = chunk.idx * created.chunkSize;
        const plainChunk = file.slice(start, Math.min(start + created.chunkSize, file.size));
        setStatus(`Encrypting chunk ${chunk.idx + 1} of ${created.chunkCount}`);
        const encrypted = await encryptChunk(plainChunk, chunk.idx, key);

        setStatus(`Uploading chunk ${chunk.idx + 1} of ${created.chunkCount}`);
        const uploadResponse = await fetch(chunk.putUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: encrypted
        });
        if (!uploadResponse.ok) {
          throw new Error(`R2 upload failed for chunk ${chunk.idx + 1}`);
        }

        await authenticatedFetch(`/api/files/${created.fileId}/chunks/${chunk.idx}`, { method: "PUT" });
        setProgress((chunk.idx + 1) / created.chunkCount);
      }

      const completeResponse = await authenticatedFetch(`/api/files/${created.fileId}/complete`, { method: "POST" });
      if (!completeResponse.ok) {
        throw new Error("Uploaded chunks but could not mark the file complete");
      }
      toast.success("Upload complete");
      setStatus("");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Upload failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function receiveFile(): Promise<void> {
    const code = receiveCode.trim().toUpperCase();
    if (!code) {
      toast.error("Enter a share code.");
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      setStatus("Loading manifest");
      const manifestResponse = await fetch(`/api/receive/${encodeURIComponent(code)}`);
      const manifest = (await manifestResponse.json()) as ReceiveManifest | { error: string };
      if (!manifestResponse.ok || "error" in manifest) {
        throw new Error("error" in manifest ? manifest.error : "Unable to load share");
      }

      const target = manifest.files[0];
      if (!target) {
        throw new Error("No files found for this code");
      }

      const key = await keyFromCode(code, target.salt);
      const parts: Blob[] = [];
      for (const chunk of target.chunks) {
        setStatus(`Downloading chunk ${chunk.idx + 1} of ${target.chunkCount}`);
        
        let downloadResponse = await fetch(chunk.getUrl);
        let retries = 0;
        
        // If R2 returns 404, the sender hasn't uploaded this chunk yet.
        // We poll every 1 second until it's available (up to ~30 mins).
        while (downloadResponse.status === 404 && retries < 1800) {
          await new Promise(r => setTimeout(r, 1000));
          downloadResponse = await fetch(chunk.getUrl);
          retries++;
        }

        if (!downloadResponse.ok) {
          throw new Error(`R2 download failed for chunk ${chunk.idx + 1}`);
        }
        setStatus(`Decrypting chunk ${chunk.idx + 1} of ${target.chunkCount}`);
        parts.push(await decryptChunk(await downloadResponse.blob(), chunk.idx, key));
        setProgress((chunk.idx + 1) / target.chunkCount);
      }

      const blob = new Blob(parts);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = target.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Download complete");
      setStatus("");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Download failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Shield size={18} />
          </span>
          <span>Shareapp</span>
        </div>
        <div className="auth">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="secondary">Sign in</button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </header>

      <section className="workspace">
        <div className="stage">
          <div className="headline">
            <h1>Encrypted file transfer by code.</h1>
            <p>
              Send up to 1 GiB through Cloudflare R2. Files are encrypted in the browser before upload and unlocked by
              the receiver&apos;s share code.
            </p>
          </div>
          <div className="rail" aria-label="Transfer properties">
            <div className="rail-item">
              <strong>01</strong>
              <span>Complete Privacy. Your files are locked on your device before they ever touch the internet.</span>
            </div>
            <div className="rail-item">
              <strong>02</strong>
              <span>Lightning Fast. Enjoy seamless, high-speed transfers without any restrictive limits.</span>
            </div>
            <div className="rail-item">
              <strong>03</strong>
              <span>Easy Sharing. Just share your unique code with the recipient to unlock the file instantly.</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="tabs" role="tablist" aria-label="Transfer mode">
            <button className={`tab ${mode === "send" ? "active" : ""}`} onClick={() => setMode("send")}>
              Send
            </button>
            <button className={`tab ${mode === "receive" ? "active" : ""}`} onClick={() => setMode("receive")}>
              Receive
            </button>
          </div>

          {mode === "send" ? (
            <div className="form">
              <SignedOut>
                <div className="status">Sign in to create a share code and upload encrypted chunks.</div>
              </SignedOut>
              <SignedIn>
                <label className="label dropzone">
                  <span className="dropzone-text">Click to choose a file...</span>
                  <input
                    className="file-input hidden"
                    type="file"
                    disabled={busy}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                {file ? (
                  <div className="status">
                    {file.name}
                    <br />
                    <span className="muted">{Math.ceil(file.size / 1024 / 1024)} MiB selected</span>
                  </div>
                ) : null}
                <button className="primary" disabled={busy || !file} onClick={sendFile}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUpFromLine size={18} />}
                  Send file
                </button>
                {shareCode ? (
                  <div className="code">
                    <div>
                      <span className="muted">Share code</span>
                      <br />
                      <strong>{shareCode}</strong>
                    </div>
                    <button className={`secondary ${copied ? 'copied' : ''}`} onClick={() => {
                      navigator.clipboard.writeText(shareCode);
                      toast.success("Code copied to clipboard!");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }} title="Copy code">
                      {copied ? <Check size={18} className="animate-pop" /> : <Copy size={18} />}
                    </button>
                  </div>
                ) : null}
              </SignedIn>
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
                  onChange={(event) => setReceiveCode(event.target.value.toUpperCase())}
                />
              </label>
              <button className="primary" disabled={busy} onClick={receiveFile}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowDownToLine size={18} />}
                Download file
              </button>
            </div>
          )}

          {busy && status ? (
            <div className="form" style={{ marginTop: 28 }}>
              <div className="progress" aria-label={progressLabel}>
                <span style={{ "--progress": progressLabel } as React.CSSProperties} />
              </div>
              <div className="status" style={{ border: 'none', background: 'transparent', padding: 0, minHeight: 'auto', textAlign: 'center', opacity: 0.8 }}>
                {status}
                <br />
                <span className="muted">{progressLabel}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
