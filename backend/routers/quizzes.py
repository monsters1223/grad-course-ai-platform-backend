"""测验路由：服务端判分（阶段一核心——标准答案只在数据库，前端无法伪造成绩）。

- GET  /api/quizzes/{section_id}/result  查询当前用户是否已提交（含解析回显所需数据）
- POST /api/quizzes/{section_id}/submit  提交作答，由服务端比对标准答案判分
"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import Course, Section, Question, QuizResult, User

router = APIRouter(prefix="/api", tags=["quizzes"])


class QuizSubmit(BaseModel):
    answers: list = []   # 各题用户所选选项下标，缺答用 -1


def _load_questions(db: Session, section_id: int):
    return (db.query(Question)
            .filter(Question.section_id == section_id)
            .order_by(Question.q_order).all())


def _quiz_row(db: Session, user: User, course_id: int, quiz_index: int):
    return (db.query(QuizResult)
            .filter(QuizResult.user_id == user.id,
                    QuizResult.course_id == course_id,
                    QuizResult.quiz_index == quiz_index)
            .first())


def _build_results(questions, user_answers):
    """按标准答案构造回显数据（correct / answer / explanation）。"""
    results = []
    for i, q in enumerate(questions):
        ua = user_answers[i] if i < len(user_answers) else -1
        results.append({
            "correct": ua == q.answer,
            "answer": q.answer,
            "explanation": q.explanation or "",
        })
    return results


@router.get("/quizzes/{section_id}/result")
def quiz_result(section_id: int, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    section = db.query(Section).filter(
        Section.id == section_id, Section.stype == "quiz").first()
    if not section:
        raise HTTPException(404, "测验不存在")
    row = _quiz_row(db, user, section.course_id, section.position)
    if not row:
        return {"submitted": False}
    questions = _load_questions(db, section_id)
    try:
        user_answers = json.loads(row.answers) if row.answers else []
    except (TypeError, ValueError):
        user_answers = []
    return {
        "submitted": True,
        "score": row.score,
        "total": row.total,
        "answers": user_answers,
        "results": _build_results(questions, user_answers),
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
    }


@router.post("/quizzes/{section_id}/submit")
def submit_quiz(section_id: int, payload: QuizSubmit,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    section = db.query(Section).filter(
        Section.id == section_id, Section.stype == "quiz").first()
    if not section:
        raise HTTPException(404, "测验不存在")
    course = db.query(Course).filter(Course.id == section.course_id).first()
    if not course:
        raise HTTPException(404, "课程不存在")

    questions = _load_questions(db, section_id)
    if not questions:
        raise HTTPException(400, "该测验暂无题目，请联系教师")

    user_answers = [int(x) if x is not None else -1 for x in (payload.answers or [])]
    total = len(questions)
    score = 0
    for i, q in enumerate(questions):
        ua = user_answers[i] if i < len(user_answers) else -1
        if ua == q.answer:
            score += 1

    # upsert（按 user+course+quiz_index 唯一），quiz_index 用 section.position 保持稳定
    row = _quiz_row(db, user, course.id, section.position)
    if row:
        row.score = score
        row.total = total
        row.quiz_title = section.title
        row.answers = json.dumps(user_answers, ensure_ascii=False)
        row.submitted_at = datetime.utcnow()
    else:
        row = QuizResult(
            user_id=user.id, course_id=course.id, quiz_index=section.position,
            quiz_title=section.title, score=score, total=total,
            answers=json.dumps(user_answers, ensure_ascii=False),
        )
        db.add(row)
    db.commit()

    return {
        "score": score,
        "total": total,
        "results": _build_results(questions, user_answers),
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
    }
