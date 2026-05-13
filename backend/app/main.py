from __future__ import annotations

import datetime as dt
import json
import math
import secrets
import uuid
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import Principal, get_principal
from .config import settings
from .db import get_db, init_db
from .models import File, FileChunk, Session as ShareSession
from .signaling import SignalingHub
from .storage import presign_get_object, presign_put_object


app = FastAPI(title="shareapp-backend", version="0.1.0")
hub = SignalingHub()


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "auth_mode": settings.auth_mode}


def _new_code() -> str:
    # 10 chars base32-ish, human friendly.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def _compute_ttl_seconds(size_bytes: int) -> int:
    # User rule: ttl = size_bits/50Mb/s + 3600
    return int(math.ceil((size_bytes * 8) / 50_000_000 + 3600))


class CreateSessionResponse(BaseModel):
    code: str
    session_id: str


_MAX_CODE_RETRIES = 5


@app.post("/v1/sessions", response_model=CreateSessionResponse)
def create_session(
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> CreateSessionResponse:
    for _ in range(_MAX_CODE_RETRIES):
        code = _new_code()
        s = ShareSession(code=code, created_by=principal.user_id)
        db.add(s)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(s)
        return CreateSessionResponse(code=s.code, session_id=s.id)
    raise HTTPException(
        status_code=409,
        detail="Could not allocate a unique session code; please try again",
    )


class CreateFileRequest(BaseModel):
    session_code: str
    filename: str
    size_bytes: int = Field(ge=1)
    chunk_size: int = Field(ge=256 * 1024, le=16 * 1024 * 1024)
    file_sha256: str = Field(min_length=64, max_length=64)
    enc_file_key: str = Field(min_length=1)


class PresignedChunk(BaseModel):
    idx: int
    put_url: str


class CreateFileResponse(BaseModel):
    file_id: str
    chunk_count: int
    expires_at: dt.datetime
    chunks: list[PresignedChunk]


@app.post("/v1/files", response_model=CreateFileResponse)
def create_file(
    req: CreateFileRequest,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> CreateFileResponse:
    sess = db.scalar(select(ShareSession).where(ShareSession.code == req.session_code))
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found")

    chunk_count = int(math.ceil(req.size_bytes / req.chunk_size))
    ttl = _compute_ttl_seconds(req.size_bytes)
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=ttl)
    file_id = str(uuid.uuid4())

    f = File(
        id=file_id,
        session_id=sess.id,
        owner_id=principal.user_id,
        filename=req.filename,
        size_bytes=req.size_bytes,
        chunk_size=req.chunk_size,
        chunk_count=chunk_count,
        file_sha256=req.file_sha256,
        enc_file_key=req.enc_file_key,
        expires_at=expires_at,
        completed=False,
    )
    db.add(f)
    db.commit()

    # Presign uploads for all chunks (ok for <= 1GiB / 4MiB = 256; keep it simple).
    chunks: list[PresignedChunk] = []
    for idx in range(chunk_count):
        key = f"files/{file_id}/{idx}"
        chunks.append(PresignedChunk(idx=idx, put_url=presign_put_object(key=key)))

    return CreateFileResponse(file_id=file_id, chunk_count=chunk_count, expires_at=expires_at, chunks=chunks)


class FileStatusResponse(BaseModel):
    present: list[int]
    completed: bool


@app.get("/v1/files/{file_id}/status", response_model=FileStatusResponse)
def file_status(
    file_id: str,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> FileStatusResponse:
    f = db.get(File, file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    # Authorization policy is minimal for now: any authenticated user with session knowledge can read status.
    rows = db.scalars(select(FileChunk.idx).where(FileChunk.file_id == file_id)).all()
    return FileStatusResponse(present=sorted(set(int(r) for r in rows)), completed=bool(f.completed))


class CompleteFileResponse(BaseModel):
    completed: bool


@app.post("/v1/files/{file_id}/complete", response_model=CompleteFileResponse)
def complete_file(
    file_id: str,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> CompleteFileResponse:
    f = db.get(File, file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    if f.owner_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Only owner can complete")

    present = db.scalars(select(FileChunk.idx).where(FileChunk.file_id == file_id)).all()
    if len(set(present)) != f.chunk_count:
        raise HTTPException(status_code=400, detail="Missing chunks")
    f.completed = True
    db.commit()
    return CompleteFileResponse(completed=True)


class ManifestResponse(BaseModel):
    file_id: str
    filename: str
    size_bytes: int
    chunk_size: int
    chunk_count: int
    file_sha256: str
    enc_file_key: str
    expires_at: dt.datetime
    completed: bool
    chunks: list[str]


@app.get("/v1/files/{file_id}/manifest", response_model=ManifestResponse)
def manifest(
    file_id: str,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> ManifestResponse:
    f = db.get(File, file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    urls = [presign_get_object(key=f"files/{file_id}/{idx}") for idx in range(f.chunk_count)]
    return ManifestResponse(
        file_id=f.id,
        filename=f.filename,
        size_bytes=f.size_bytes,
        chunk_size=f.chunk_size,
        chunk_count=f.chunk_count,
        file_sha256=f.file_sha256,
        enc_file_key=f.enc_file_key,
        expires_at=f.expires_at,
        completed=bool(f.completed),
        chunks=urls,
    )


@app.websocket("/v1/ws/{session_code}")
async def ws_signaling(
    websocket: WebSocket,
    session_code: str,
    db: Session = Depends(get_db),
) -> None:
    # Auth for websockets: dev mode accepts ?token=<id>; clerk mode expects Authorization header.
    principal: Principal
    if settings.auth_mode == "dev":
        token = websocket.query_params.get("token") or "dev-user"
        principal = Principal(user_id=token)
    else:
        principal = get_principal(authorization=websocket.headers.get("authorization"))

    sess = db.scalar(select(ShareSession).where(ShareSession.code == session_code))
    if sess is None:
        await websocket.close(code=4404)
        return

    user_id = principal.user_id
    await hub.connect(room_code=session_code, user_id=user_id, ws=websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if not isinstance(msg, dict):
                    continue
            except Exception:
                continue
            await hub.relay(room_code=session_code, sender=user_id, message=msg)
    except WebSocketDisconnect:
        await hub.disconnect(room_code=session_code, user_id=user_id)


@app.put("/v1/files/{file_id}/chunks/{idx}")
def mark_chunk_uploaded(
    file_id: str,
    idx: int,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    Optional helper: call this after uploading chunk to R2/S3 via presigned URL.
    (Keeping the actual bytes out of the FastAPI process.)
    """
    f = db.get(File, file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    if f.owner_id != principal.user_id:
        raise HTTPException(status_code=403, detail="Only owner can upload chunks")
    if idx < 0 or idx >= f.chunk_count:
        raise HTTPException(status_code=400, detail="Invalid chunk index")

    existing = db.scalar(select(FileChunk).where(FileChunk.file_id == file_id, FileChunk.idx == idx))
    if existing is None:
        db.add(FileChunk(file_id=file_id, idx=idx, bytes=0))
        db.commit()
    return {"ok": True}

