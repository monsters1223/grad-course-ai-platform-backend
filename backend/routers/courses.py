"""课程与章节路由。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db
from models import Course, Section, ChatRoom

router = APIRouter(prefix="/api", tags=["courses"])


@router.get("/courses")
def list_courses(db: Session = Depends(get_db)):
    courses = db.query(Course).all()
    return [{
        "id": c.id, "title": c.title, "teacher": c.teacher,
        "cover": c.cover, "category": c.category,
        "desc": c.desc, "progress": c.progress,
        "ai_classroom_url": c.ai_classroom_url,
    } for c in courses]


@router.get("/courses/{cid}")
def course_detail(cid: int, db: Session = Depends(get_db)):
    c = db.query(Course).filter(Course.id == cid).first()
    if not c:
        raise HTTPException(404, "课程不存在")
    sections = db.query(Section).filter(Section.course_id == cid) \
        .order_by(Section.position).all()
    room = db.query(ChatRoom).filter(
        ChatRoom.course_id == cid, ChatRoom.rtype == "class").first()
    return {
        "id": c.id, "title": c.title, "teacher": c.teacher,
        "cover": c.cover, "category": c.category, "desc": c.desc,
        "progress": c.progress, "ai_classroom_url": c.ai_classroom_url,
        "sections": [{"id": s.id, "title": s.title, "stype": s.stype,
                      "content": s.content} for s in sections],
        "class_group_id": room.id if room else None,
    }
