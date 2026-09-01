"""课堂签到路由。"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from core.utils import fmt
from models import SignIn, User

router = APIRouter(prefix="/api", tags=["checkin"])


class SignInIn(BaseModel):
    course_id: int
    method: str
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/signin")
def do_signin(body: SignInIn, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    allowed = {"location", "gesture", "photo", "qr"}
    if body.method not in allowed:
        raise HTTPException(400, "不支持的签到方式")
    s = SignIn(user_id=user.id, course_id=body.course_id, method=body.method,
               lat=body.lat, lng=body.lng, status="success")
    db.add(s)
    db.commit()
    return {"ok": True, "method": body.method, "time": fmt(s.created_at)}


@router.get("/signin/me")
def my_signins(db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    items = db.query(SignIn).filter(SignIn.user_id == user.id) \
        .order_by(SignIn.created_at.desc()).all()
    return [{
        "id": s.id, "course_id": s.course_id, "method": s.method,
        "status": s.status, "created_at": fmt(s.created_at),
    } for s in items]
