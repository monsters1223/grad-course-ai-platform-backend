"""作业与提交路由。"""
import os
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.config import settings
from core.security import get_current_user
from models import Homework, Submission, User

router = APIRouter(prefix="/api", tags=["assignments"])

# 上传文件根目录：容器部署用 DATA_DIR=/app/data；Windows 原生部署用绝对路径。
# 未配置时默认 backend/data/uploads（不再硬编码 Linux 路径，保证跨平台可运行）。
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = (settings.data_dir or os.environ.get("DATA_DIR") or
            os.path.join(_BACKEND_DIR, "data")).strip()
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")


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
            "file_name": sub.file_name if sub else None,
        })
    return out


class SubmitIn(BaseModel):
    homework_id: int
    answer: str


@router.post("/homeworks/submit")
def submit(body: SubmitIn, db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    # 存在性校验：防止提交到不存在的作业，产生孤儿 submission 脏数据
    if not db.query(Homework).filter(Homework.id == body.homework_id).first():
        raise HTTPException(404, "作业不存在")
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


@router.post("/homeworks/submit-file")
async def submit_file(
    homework_id: int = Form(...),
    answer: str = Form(""),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """带附件的作业提交。文件可选，与文字答案并存。"""
    hw = db.query(Homework).filter(Homework.id == homework_id).first()
    if not hw:
        raise HTTPException(404, "作业不存在")

    saved_path = None
    original_name = None
    if file and file.filename:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        original_name = file.filename
        ext = os.path.splitext(original_name)[1]
        saved_name = f"{user.id}_{homework_id}_{uuid.uuid4().hex}{ext}"
        dest = os.path.join(UPLOAD_DIR, saved_name)
        content = await file.read()
        with open(dest, "wb") as f:
            f.write(content)
        saved_path = f"uploads/{saved_name}"  # 相对 DATA_DIR 的路径

    sub = db.query(Submission).filter(
        Submission.homework_id == homework_id,
        Submission.user_id == user.id).first()
    if sub:
        sub.answer = answer
        sub.file_path = saved_path
        sub.file_name = original_name
        sub.submitted_at = datetime.utcnow()
    else:
        sub = Submission(
            homework_id=homework_id, user_id=user.id,
            answer=answer, file_path=saved_path, file_name=original_name,
        )
        db.add(sub)
    db.commit()
    return {"ok": True, "file_name": original_name}
