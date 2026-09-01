"""WebSocket 群聊。"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from core.database import SessionLocal
from core.security import decode_token
from core.utils import fmt
from models import User, Message

router = APIRouter(tags=["chat"])


class ConnectionManager:
    def __init__(self):
        self.rooms: dict[int, set] = {}

    async def connect(self, rid: int, ws: WebSocket):
        self.rooms.setdefault(rid, set()).add(ws)

    def disconnect(self, rid: int, ws: WebSocket):
        s = self.rooms.get(rid)
        if s and ws in s:
            s.discard(ws)

    async def broadcast(self, rid: int, msg: dict):
        for ws in list(self.rooms.get(rid, set())):
            try:
                await ws.send_json(msg)
            except Exception:
                pass


manager = ConnectionManager()


async def _ws_auth(token: str):
    payload = decode_token(token or "")
    if not payload:
        return None
    db = SessionLocal()
    try:
        return db.query(User).filter(User.id == int(payload["sub"])).first()
    finally:
        db.close()


@router.websocket("/ws/chat/{rid}")
async def ws_chat(rid: int, ws: WebSocket, token: str = Query(None)):
    user = await _ws_auth(token)
    if not user:
        await ws.close(code=1008)
        return
    await ws.accept()
    await manager.connect(rid, ws)
    try:
        while True:
            data = await ws.receive_json()
            mtype = data.get("mtype", "text")
            content = data.get("content", "")
            db = SessionLocal()
            msg = Message(room_id=rid, user_id=user.id,
                          mtype=mtype, content=content)
            db.add(msg)
            db.commit()
            db.refresh(msg)
            payload = {
                "id": msg.id, "user": user.name, "avatar": user.avatar,
                "mtype": mtype, "content": content,
                "created_at": fmt(msg.created_at),
            }
            db.close()
            await manager.broadcast(rid, payload)
    except WebSocketDisconnect:
        manager.disconnect(rid, ws)
