"""课程讨论路由。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from core.utils import fmt
from models import Discussion, User, Course

router = APIRouter(prefix="/api", tags=["discussion"])


class DiscussionIn(BaseModel):
    course_id: int
    content: str
    parent_id: int = None


@router.get("/courses/{cid}/discussions")
def list_discussions(cid: int, db: Session = Depends(get_db)):
    items = db.query(Discussion).filter(Discussion.course_id == cid) \
        .order_by(Discussion.created_at.desc()).all()
    out = []
    for d in items:
        u = db.query(User).filter(User.id == d.user_id).first()
        out.append({
            "id": d.id, "user": u.name if u else "匿名",
            "avatar": u.avatar if u else "?",
            "content": d.content, "created_at": fmt(d.created_at),
        })
    return out


@router.post("/discussions")
def post_discussion(body: DiscussionIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    c = db.query(Course).filter(Course.id == body.course_id).first()
    if not c:
        raise HTTPException(404, "课程不存在")
    d = Discussion(course_id=body.course_id, user_id=user.id,
                   content=body.content, parent_id=body.parent_id)
    db.add(d)
    db.commit()
    return {"ok": True}
