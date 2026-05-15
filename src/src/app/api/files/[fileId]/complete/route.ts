import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { completeFile, countChunks, getFile } from "@/lib/d1";

type Params = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { fileId } = await params;
  const file = await getFile(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_id !== userId) {
    return NextResponse.json({ error: "Only the owner can complete this file" }, { status: 403 });
  }

  const uploaded = await countChunks(fileId);
  if (uploaded !== file.chunk_count) {
    return NextResponse.json({ error: "Missing chunks", uploaded, expected: file.chunk_count }, { status: 400 });
  }

  await completeFile(fileId);
  return NextResponse.json({ completed: true });
}
