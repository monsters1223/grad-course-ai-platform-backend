"""学情看板路由。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from models import Course, SignIn, Submission, User

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    total_courses = db.query(Course).count()
    done_signins = db.query(SignIn).filter(SignIn.user_id == user.id).count()
    submissions = db.query(Submission).filter(Submission.user_id == user.id).all()
    scored = [s for s in submissions if s.score]
    avg = 0.0
    if scored:
        nums = []
        for s in scored:
            try:
                nums.append(float(str(s.score).replace("%", "")))
            except Exception:
                pass
        avg = round(sum(nums) / len(nums), 1) if nums else 0.0
    # 学习时长（演示用：按签到/提交数量估算）
    study_hours = round(done_signins * 0.8 + len(submissions) * 0.5, 1)
    return {
        "total_courses": total_courses,
        "signin_count": done_signins,
        "submission_count": len(submissions),
        "avg_score": avg,
        "study_hours": study_hours,
        "streak_days": done_signins,
    }
