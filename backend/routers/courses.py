"""课程与章节路由。"""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from core.database import get_db
from core.utils import fmt
from core.security import get_current_user
from models import Course, Section, ChatRoom, Question, Homework, Announcement, User

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


def _parse_options(raw):
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return []


def _section_out(s: Section, db: Session):
    """章节输出：quiz 类型附带题目，但绝不返回 answer（标准答案仅服务端持有）。"""
    out = {"id": s.id, "title": s.title, "stype": s.stype, "content": s.content}
    if s.stype == "quiz":
        qs = db.query(Question).filter(Question.section_id == s.id) \
                 .order_by(Question.q_order).all()
        out["questions"] = [{
            "text": q.q_text,
            "options": _parse_options(q.options),
            "explanation": q.explanation or "",
        } for q in qs]
    return out


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
        "sections": [_section_out(s, db) for s in sections],
        "homeworks": [{"id": h.id, "title": h.title, "desc": h.desc, "due": h.due}
                      for h in db.query(Homework).filter(Homework.course_id == cid).all()],
        # 教师发布的公告随课程详情返回：学生端「公告」标签页直接可读，无需二次请求
        "announcements": _announcements_out(db, cid),
        "class_group_id": room.id if room else None,
    }


def _announcements_out(db: Session, cid: int, limit: int = 50):
    items = (db.query(Announcement).filter(Announcement.course_id == cid)
             .order_by(Announcement.created_at.desc()).limit(limit).all())
    out = []
    for a in items:
        author = db.query(User).filter(User.id == a.author_id).first()
        out.append({
            "id": a.id, "title": a.title, "content": a.content or "",
            "author": author.name if author else "教师",
            "created_at": fmt(a.created_at),
        })
    return out


@router.get("/courses/{cid}/announcements")
def course_announcements(cid: int, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """学生端公告列表（教师视角另见 /api/teacher/courses/{cid}/announcements）。"""
    if not db.query(Course).filter(Course.id == cid).first():
        raise HTTPException(404, "课程不存在")
    return _announcements_out(db, cid)
