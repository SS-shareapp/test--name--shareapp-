import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getFile, markChunk } from "@/lib/d1";

type Params = {
  params: {
    fileId: string;
    idx: string;
  };
};

export async function PUT(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { fileId, idx: rawIdx } = params;
  const idx = Number(rawIdx);
  const file = await getFile(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_id !== userId) {
    return NextResponse.json({ error: "Only the owner can update chunks" }, { status: 403 });
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= file.chunk_count) {
    return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
  }

  await markChunk(fileId, idx);
  return NextResponse.json({ ok: true });
}
