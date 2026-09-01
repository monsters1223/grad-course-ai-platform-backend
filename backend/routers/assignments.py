"""作业与提交路由。"""
from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from models import Homework, Submission, User

router = APIRouter(prefix="/api", tags=["assignments"])


@router.get("/courses/{cid}/homeworks")
def list_homeworks(cid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    hws = db.query(Homework).filter(Homework.course_id == cid).all()
    out = []
    for h in hws:
        sub = db.query(Submission).filter(
            Submission.homework_id == h.id, Submission.user_id == user.id).first()
        out.append({
            "id": h.id, "title": h.title, "desc": h.desc, "due": h.due,
            "submitted": bool(sub), "score": sub.score if sub else None,
        })
    return out


class SubmitIn(BaseModel):
    homework_id: int
    answer: str


@router.post("/homeworks/submit")
def submit(body: SubmitIn, db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    sub = db.query(Submission).filter(
        Submission.homework_id == body.homework_id,
        Submission.user_id == user.id).first()
    if sub:
        sub.answer = body.answer
        sub.submitted_at = datetime.utcnow()
    else:
        sub = Submission(homework_id=body.homework_id, user_id=user.id,
                         answer=body.answer)
        db.add(sub)
    db.commit()
    return {"ok": True}
