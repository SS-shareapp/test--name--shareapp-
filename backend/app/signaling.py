from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Room:
    # user_id -> websocket
    peers: dict[str, WebSocket] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class SignalingHub:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._rooms_lock = asyncio.Lock()

    async def connect(self, *, room_code: str, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        room = await self._get_or_create(room_code)
        async with room.lock:
            room.peers[user_id] = ws
        await self._broadcast(
            room_code,
            {"type": "peer-join", "peer": user_id, "peers": list(room.peers.keys())},
        )

    async def disconnect(self, *, room_code: str, user_id: str) -> None:
        room = await self._get(room_code)
        if room is None:
            return
        async with room.lock:
            room.peers.pop(user_id, None)
            peers = list(room.peers.keys())
        await self._broadcast(room_code, {"type": "peer-leave", "peer": user_id, "peers": peers})

    async def relay(self, *, room_code: str, sender: str, message: dict) -> None:
        """
        Message format (recommended):
        - {type: "offer"|"answer"|"ice", to: "<peer-id>", data: {...}}
        - {type: "...", to: null} to broadcast
        """
        to = message.get("to")
        if to:
            await self._send(room_code, to, {"from": sender, **message})
        else:
            await self._broadcast(room_code, {"from": sender, **message})

    async def _get_or_create(self, code: str) -> Room:
        async with self._rooms_lock:
            room = self._rooms.get(code)
            if room is None:
                room = Room()
                self._rooms[code] = room
            return room

    async def _get(self, code: str) -> Room | None:
        async with self._rooms_lock:
            return self._rooms.get(code)

    async def _send(self, code: str, user_id: str, payload: dict) -> None:
        room = await self._get(code)
        if room is None:
            return
        async with room.lock:
            ws = room.peers.get(user_id)
        if ws is None:
            return
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            # Caller will handle disconnect.
            return

    async def _broadcast(self, code: str, payload: dict) -> None:
        room = await self._get(code)
        if room is None:
            return
        async with room.lock:
            peers = list(room.peers.values())
        msg = json.dumps(payload)
        for ws in peers:
            try:
                await ws.send_text(msg)
            except Exception:
                continue

