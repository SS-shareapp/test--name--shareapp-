import postgres from "postgres";
import { env } from "@/lib/env";

let db: postgres.Sql;

function getDb(): postgres.Sql {
  if (!db) {
    db = postgres(env.neonUrl(), {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10
    });
  }
  return db;
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
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      share_id TEXT NOT NULL REFERENCES shares(id),
      owner_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      chunk_size INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      file_sha256 TEXT NOT NULL,
      wrapped_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS chunks (
      file_id TEXT NOT NULL REFERENCES files(id),
      idx INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (file_id, idx)
    );
  `;
}

export async function createShare(row: ShareRow): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO shares (id, code, owner_id, created_at, expires_at)
    VALUES (${row.id}, ${row.code}, ${row.owner_id}, ${row.created_at}, ${row.expires_at})
  `;
}

export async function createFile(row: FileRow): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO files
      (id, share_id, owner_id, filename, size_bytes, chunk_size, chunk_count, file_sha256, wrapped_key, created_at, expires_at, completed)
    VALUES
      (${row.id}, ${row.share_id}, ${row.owner_id}, ${row.filename}, ${row.size_bytes}, ${row.chunk_size}, ${row.chunk_count}, ${row.file_sha256}, ${row.wrapped_key}, ${row.created_at}, ${row.expires_at}, ${row.completed})
  `;
}

export async function getShareByCode(code: string): Promise<ShareRow | null> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql<ShareRow>`SELECT * FROM shares WHERE code = ${code} LIMIT 1`;
  return rows[0] ?? null;
}

export async function getFile(id: string): Promise<FileRow | null> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql<FileRow>`SELECT * FROM files WHERE id = ${id} LIMIT 1`;
  return rows[0] ?? null;
}

export async function getFilesForShare(shareId: string): Promise<FileRow[]> {
  await ensureSchema();
  const sql = getDb();
  return sql<FileRow>`SELECT * FROM files WHERE share_id = ${shareId} ORDER BY created_at ASC`;
}

export async function markChunk(fileId: string, idx: number): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO chunks (file_id, idx, created_at)
    VALUES (${fileId}, ${idx}, ${new Date().toISOString()})
    ON CONFLICT (file_id, idx) DO NOTHING
  `;
}

export async function completeFile(fileId: string): Promise<void> {
  await ensureSchema();
  const sql = getDb();
  await sql`UPDATE files SET completed = 1 WHERE id = ${fileId}`;
}

export async function countChunks(fileId: string): Promise<number> {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql<{ count: number }>`SELECT COUNT(*) as count FROM chunks WHERE file_id = ${fileId}`;
  return Number(rows[0]?.count ?? 0);
}
