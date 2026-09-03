"""学情看板路由：上报学习进度 + 读取真实聚合。

阶段二（学情真实化）：
- 前端在观看视频心跳、提交测验时，调用 /api/progress/* 把数据落到 study_logs / quiz_results；
- 看板 /api/dashboard 从这些表 + 签到表真实聚合，不再使用写死的演示数据。
"""
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import Course, SignIn, StudyLog, QuizResult, User

router = APIRouter(prefix="/api", tags=["analytics"])

WD = ["日", "一", "二", "三", "四", "五", "六"]


# ---------- 上报入参 ----------
class VideoProgressIn(BaseModel):
    course_id: int
    section_index: int = 0
    section_title: str = ""
    progress: int = 0          # 视频完成百分比 0-100
    watch_seconds: int = 0     # 当前播放位置（秒）


class QuizResultIn(BaseModel):
    course_id: int
    quiz_index: int = 0
    quiz_title: str = ""
    score: int = 0
    total: int = 0


# ---------- 上报接口（按 user+course+section 唯一 upsert） ----------
@router.post("/progress/video")
def report_video(payload: VideoProgressIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    row = (db.query(StudyLog)
           .filter(StudyLog.user_id == user.id,
                   StudyLog.course_id == payload.course_id,
                   StudyLog.section_index == payload.section_index)
           .first())
    if row:
        if payload.progress > row.progress:
            row.progress = payload.progress
        if payload.watch_seconds > row.watch_seconds:
            row.watch_seconds = payload.watch_seconds
        if payload.section_title:
            row.section_title = payload.section_title
        row.last_at = datetime.utcnow()
    else:
        row = StudyLog(
            user_id=user.id, course_id=payload.course_id,
            section_index=payload.section_index, section_title=payload.section_title,
            progress=payload.progress, watch_seconds=payload.watch_seconds,
        )
        db.add(row)
    db.commit()
    return {"ok": True}


@router.post("/progress/quiz")
def report_quiz(payload: QuizResultIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    row = (db.query(QuizResult)
           .filter(QuizResult.user_id == user.id,
                   QuizResult.course_id == payload.course_id,
                   QuizResult.quiz_index == payload.quiz_index)
           .first())
    if row:
        row.score = payload.score
        row.total = payload.total
        row.quiz_title = payload.quiz_title
        row.submitted_at = datetime.utcnow()
    else:
        row = QuizResult(
            user_id=user.id, course_id=payload.course_id,
            quiz_index=payload.quiz_index, quiz_title=payload.quiz_title,
            score=payload.score, total=payload.total,
        )
        db.add(row)
    db.commit()
    return {"ok": True}


# ---------- 看板聚合（真实数据） ----------
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # 视频学习记录
    logs = db.query(StudyLog).filter(StudyLog.user_id == user.id).all()
    by_course: dict = defaultdict(list)
    total_watch = 0
    for l in logs:
        by_course[l.course_id].append(l)
        total_watch += max(l.watch_seconds, 0)

    # 测验成绩
    qrs = db.query(QuizResult).filter(QuizResult.user_id == user.id).all()
    quiz_by_course: dict = defaultdict(list)
    for q in qrs:
        quiz_by_course[q.course_id].append(q)

    # 签到次数
    signin_count = db.query(SignIn).filter(SignIn.user_id == user.id).count()

    # 每门课明细（先放视频侧，再合并测验侧）
    course_details = []
    per_course_progress = []
    per_course_quiz = []

    def title_of(cid):
        c = db.query(Course).filter(Course.id == cid).first()
        return c.title if c else ("课程#" + str(cid))

    for cid, secs in by_course.items():
        avg_prog = round(sum(s.progress for s in secs) / len(secs)) if secs else 0
        study_h = round(sum(max(s.watch_seconds, 0) for s in secs) / 3600, 1)
        per_course_progress.append(avg_prog)
        course_details.append({
            "course_id": cid,
            "title": title_of(cid),
            "video_progress": avg_prog,
            "study_hours": study_h,
            "quiz_avg": 0,
            "quiz_done": 0,
        })

    for cid, qs in quiz_by_course.items():
        avg_pct = 0
        if qs:
            nums = [round((q.score / q.total) * 100) if q.total else 0 for q in qs]
            avg_pct = round(sum(nums) / len(nums))
        per_course_quiz.append(avg_pct)
        existing = next((c for c in course_details if c["course_id"] == cid), None)
        if existing:
            existing["quiz_avg"] = avg_pct
            existing["quiz_done"] = len(qs)
        else:
            course_details.append({
                "course_id": cid,
                "title": title_of(cid),
                "video_progress": 0,
                "study_hours": 0,
                "quiz_avg": avg_pct,
                "quiz_done": len(qs),
            })

    study_hours = round(total_watch / 3600, 1)
    avg_video = round(sum(per_course_progress) / len(per_course_progress)) if per_course_progress else 0
    avg_quiz = round(sum(per_course_quiz) / len(per_course_quiz)) if per_course_quiz else 0

    # 本周学习时长（按 last_at 日期聚合 watch_seconds）
    today = datetime.utcnow().date()
    weekly = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        secs = sum(max(l.watch_seconds, 0) for l in logs if l.last_at and l.last_at.date() == day)
        weekly.append({"label": "周" + WD[day.weekday()], "val": secs // 60})

    return {
        "study_hours": study_hours,
        "avg_video_progress": avg_video,
        "avg_quiz_score": avg_quiz,
        "signin_count": signin_count,
        "course_details": course_details,
        "weekly": weekly,
    }
