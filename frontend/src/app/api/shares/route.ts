import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CHUNK_SIZE, MAX_FILE_BYTES, computeExpiresAt } from "@/lib/constants";
import { newShareCode } from "@/lib/code";
import { createFile, createShare } from "@/lib/d1";
import { objectKey, presignPut } from "@/lib/r2";

type CreateShareBody = {
  filename: string;
  sizeBytes: number;
  fileSha256: string;
  salt: string;
  chunkSize?: number;
};

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<CreateShareBody>;
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const sizeBytes = Number(body.sizeBytes);
  const chunkSize = Number(body.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const fileSha256 = typeof body.fileSha256 === "string" ? body.fileSha256 : "";
  const salt = typeof body.salt === "string" ? body.salt : "";

  if (!filename) return badRequest("Filename is required");
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) return badRequest("Invalid file size");
  if (sizeBytes > MAX_FILE_BYTES) return badRequest("Files are limited to 2 GiB");
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 256 * 1024 || chunkSize > 16 * 1024 * 1024) {
    return badRequest("Invalid chunk size");
  }
  if (!/^[a-f0-9]{64}$/i.test(fileSha256)) return badRequest("Invalid SHA-256 hash");
  if (!salt) return badRequest("Encryption salt is required");

  const now = new Date().toISOString();
  const expiresAt = computeExpiresAt(sizeBytes);
  const shareId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const code = newShareCode();
  const chunkCount = Math.ceil(sizeBytes / chunkSize);

  await createShare({
    id: shareId,
    code,
    owner_id: userId,
    created_at: now,
    expires_at: expiresAt
  });
  await createFile({
    id: fileId,
    share_id: shareId,
    owner_id: userId,
    filename,
    size_bytes: sizeBytes,
    chunk_size: chunkSize,
    chunk_count: chunkCount,
    file_sha256: fileSha256,
    wrapped_key: salt,
    created_at: now,
    expires_at: expiresAt,
    completed: 0
  });

  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, async (_, idx) => ({
      idx,
      putUrl: await presignPut(objectKey(fileId, idx))
    }))
  );

  return NextResponse.json({
    code,
    fileId,
    chunkSize,
    chunkCount,
    expiresAt,
    chunks
  });
}
