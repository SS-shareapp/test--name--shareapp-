import { env } from "@/lib/env";

type D1Result<T> = {
  success: boolean;
  errors: { code: number; message: string }[];
  result: Array<{
    success: boolean;
    results: T[];
    meta: unknown;
  }>;
};

async function d1Query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId()}/d1/database/${env.d1DatabaseId()}/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.d1ApiToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store"
  });

  const payload = (await response.json()) as D1Result<T>;
  if (!response.ok || !payload.success || !payload.result?.[0]?.success) {
    const detail = payload.errors?.map((error) => error.message).join(", ") || response.statusText;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return payload.result[0].results;
}

export type ShareRow = {
  id: string;
  code: string;
  owner_id: string;
  created_at: string;
  expires_at: string;
};

export type FileRow = {
  id: string;
  share_id: string;
  owner_id: string;
  filename: string;
  size_bytes: number;
  chunk_size: number;
  chunk_count: number;
  file_sha256: string;
  wrapped_key: string;
  created_at: string;
  expires_at: string;
  completed: number;
};

export async function ensureSchema(): Promise<void> {
  await d1Query(`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  await d1Query(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      share_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      file_sha256 TEXT NOT NULL,
      wrapped_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (share_id) REFERENCES shares(id)
    );
  `);
  await d1Query(`
    CREATE TABLE IF NOT EXISTS chunks (
      file_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (file_id, idx),
      FOREIGN KEY (file_id) REFERENCES files(id)
    );
  `);
}

export async function createShare(row: ShareRow): Promise<void> {
  await ensureSchema();
  await d1Query(
    "INSERT INTO shares (id, code, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [row.id, row.code, row.owner_id, row.created_at, row.expires_at]
  );
}

export async function createFile(row: FileRow): Promise<void> {
  await ensureSchema();
  await d1Query(
    `INSERT INTO files
      (id, share_id, owner_id, filename, size_bytes, chunk_size, chunk_count, file_sha256, wrapped_key, created_at, expires_at, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.share_id,
      row.owner_id,
      row.filename,
      row.size_bytes,
      row.chunk_size,
      row.chunk_count,
      row.file_sha256,
      row.wrapped_key,
      row.created_at,
      row.expires_at,
      row.completed
    ]
  );
}

export async function getShareByCode(code: string): Promise<ShareRow | null> {
  await ensureSchema();
  const rows = await d1Query<ShareRow>("SELECT * FROM shares WHERE code = ? LIMIT 1", [code]);
  return rows[0] ?? null;
}

export async function getFile(id: string): Promise<FileRow | null> {
  await ensureSchema();
  const rows = await d1Query<FileRow>("SELECT * FROM files WHERE id = ? LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function getFilesForShare(shareId: string): Promise<FileRow[]> {
  await ensureSchema();
  return d1Query<FileRow>("SELECT * FROM files WHERE share_id = ? ORDER BY created_at ASC", [shareId]);
}

export async function markChunk(fileId: string, idx: number): Promise<void> {
  await ensureSchema();
  await d1Query("INSERT OR IGNORE INTO chunks (file_id, idx, created_at) VALUES (?, ?, ?)", [
    fileId,
    idx,
    new Date().toISOString()
  ]);
}

export async function completeFile(fileId: string): Promise<void> {
  await ensureSchema();
  await d1Query("UPDATE files SET completed = 1 WHERE id = ?", [fileId]);
}

export async function countChunks(fileId: string): Promise<number> {
  await ensureSchema();
  const rows = await d1Query<{ count: number }>("SELECT COUNT(*) as count FROM chunks WHERE file_id = ?", [fileId]);
  return Number(rows[0]?.count ?? 0);
}
