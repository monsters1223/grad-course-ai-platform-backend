"""群聊房间 / 学习小组路由。"""
from typing import List, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from core.utils import fmt
from models import ChatRoom, ChatMember, Message, StudyGroup, User

router = APIRouter(prefix="/api", tags=["groups"])


@router.get("/rooms")
def my_rooms(db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    member_room_ids = db.query(ChatMember.room_id).filter(
        ChatMember.user_id == user.id).subquery()
    rooms = db.query(ChatRoom).filter(ChatRoom.id.in_(member_room_ids)).all()
    out = []
    for r in rooms:
        last = db.query(Message).filter(Message.room_id == r.id) \
            .order_by(Message.created_at.desc()).first()
        out.append({
            "id": r.id, "name": r.name, "rtype": r.rtype,
            "course_id": r.course_id,
            "last": last.content[:30] if last else "",
        })
    return out


@router.get("/rooms/{rid}/messages")
def room_history(rid: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    msgs = db.query(Message).filter(Message.room_id == rid) \
        .order_by(Message.created_at).all()
    out = []
    for m in msgs:
        u = db.query(User).filter(User.id == m.user_id).first()
        out.append({
            "id": m.id, "user": u.name if u else "匿名",
            "avatar": u.avatar if u else "?",
            "mtype": m.mtype, "content": m.content,
            "created_at": fmt(m.created_at),
        })
    return out


class GroupIn(BaseModel):
    name: str
    course_id: Optional[int] = None
    visibility: str = "public"
    desc: str = ""
    invite_usernames: List[str] = []


@router.post("/groups")
def create_group(body: GroupIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    room = ChatRoom(rtype="group", name=body.name,
                    course_id=body.course_id, owner_id=user.id)
    db.add(room)
    db.flush()
    db.add(ChatMember(room_id=room.id, user_id=user.id, role="owner"))
    for uname in body.invite_usernames:
        inv = db.query(User).filter(User.username == uname).first()
        if inv:
            db.add(ChatMember(room_id=room.id, user_id=inv.id, role="member"))
    g = StudyGroup(room_id=room.id, course_id=body.course_id or 0,
                   name=body.name, visibility=body.visibility,
                   desc=body.desc, owner_id=user.id)
    db.add(g)
    db.commit()
    return {"ok": True, "room_id": room.id}


@router.post("/groups/{gid}/join")
def join_group(gid: int, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    g = db.query(StudyGroup).filter(StudyGroup.id == gid).first()
    if not g:
        raise HTTPException(404, "小组不存在")
    if g.visibility == "private":
        raise HTTPException(403, "私密小组需邀请")
    exists = db.query(ChatMember).filter(
        ChatMember.room_id == g.room_id, ChatMember.user_id == user.id).first()
    if not exists:
        db.add(ChatMember(room_id=g.room_id, user_id=user.id, role="member"))
        db.commit()
    return {"ok": True}


@router.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.query(StudyGroup).all()
    out = []
    for g in groups:
        cnt = db.query(ChatMember).filter(ChatMember.room_id == g.room_id).count()
        out.append({
            "id": g.id, "name": g.name, "visibility": g.visibility,
            "desc": g.desc, "members": cnt,
        })
    return out
