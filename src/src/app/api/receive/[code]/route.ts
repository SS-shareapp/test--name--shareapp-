import { NextRequest, NextResponse } from "next/server";
import { getFilesForShare, getShareByCode } from "@/lib/d1";
import { objectKey, presignGet } from "@/lib/r2";

type Params = {
  params: Promise<{
    code: string;
  }>;
};

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { code } = await params;
  const normalizedCode = code.trim().toUpperCase();
  const share = await getShareByCode(normalizedCode);
  if (!share) {
    return NextResponse.json({ error: "Share code not found" }, { status: 404 });
  }
  if (Date.parse(share.expires_at) < Date.now()) {
    return NextResponse.json({ error: "Share code expired" }, { status: 410 });
  }

  const files = await getFilesForShare(share.id);
  const manifests = await Promise.all(
    files.map(async (file) => ({
      fileId: file.id,
      filename: file.filename,
      sizeBytes: file.size_bytes,
      chunkSize: file.chunk_size,
      chunkCount: file.chunk_count,
      fileSha256: file.file_sha256,
      salt: file.wrapped_key,
      expiresAt: file.expires_at,
      completed: Boolean(file.completed),
      chunks: await Promise.all(
        Array.from({ length: file.chunk_count }, async (_, idx) => ({
          idx,
          getUrl: await presignGet(objectKey(file.id, idx))
        }))
      )
    }))
  );

  return NextResponse.json({
    code: normalizedCode,
    expiresAt: share.expires_at,
    files: manifests
  });
}
