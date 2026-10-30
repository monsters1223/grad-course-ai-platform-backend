"""作业与提交路由。"""
import os
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db, UPLOAD_DIR
from core.security import get_current_user
from core.notify import notify_course_teacher
from models import Homework, Submission, User, Course

router = APIRouter(prefix="/api", tags=["assignments"])

# 作业附件根目录：必须与 main.py 挂载的 /files 指向同一目录（core.database.UPLOAD_DIR = backend/uploads），
# 否则学生上传的附件教师端在 /files 下下载不到。故直接复用 core.database.UPLOAD_DIR，不再自造 data/uploads。


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
    hw = db.query(Homework).filter(Homework.id == body.homework_id).first()
    if not hw:
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
    # 教师端联动：学生交作业后，任课教师铃铛即时提醒，可直达批改台
    notify_course_teacher(
        db, hw.course_id, kind="submission",
        title="%s 提交了作业：%s" % (user.name, hw.title),
        body=(body.answer or "").strip()[:100],
        tab="grading", ref_id=hw.id, actor_id=user.id,
    )
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
        saved_path = saved_name  # 仅存文件名；/files 挂载在 backend/uploads，故 /files/<saved_name> 可直链下载

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
    # 教师端联动：带附件提交同样通知（提示附件名，便于教师判断批改成本）
    notify_course_teacher(
        db, hw.course_id, kind="submission",
        title="%s 提交了作业：%s" % (user.name, hw.title),
        body=("附件：" + original_name) if original_name else (answer or "").strip()[:100],
        tab="grading", ref_id=hw.id, actor_id=user.id,
    )
    return {"ok": True, "file_name": original_name}
