"""教师端路由。

安全约定：
  - 所有接口先经 `get_current_user` 取当前用户，再调用 `require_teacher` 做角色守卫；
  - 课程类写操作前必须校验 `course.teacher_id == user.id`（行级隔离）；
  - 公告编辑/删除额外校验 `author_id == user.id`。

范围（按规格 §5）：
  课程与内容 / 学生名单 / 作业批改 / 班级学情 / 签到管理 / 公告。
"""
import os
import io
import json
import re
import uuid
import csv
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from openpyxl import Workbook, load_workbook

from core.database import get_db, UPLOAD_DIR
from core.security import get_current_user, hash_password
from core.notify import notify_course_students, notify_users
from models import (
    User, Course, Section, Question, Homework, Submission, Enrollment,
    SignIn, StudyLog, QuizResult, Announcement, SigninSession, ChatRoom,
    ChatMember, Message,
)

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


# ---------------------------------------------------------------------------
# 守卫与通用 helpers
# ---------------------------------------------------------------------------
def require_teacher(user: User) -> User:
    """角色守卫：非教师角色一律 403。"""
    if user.role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无教师权限")
    return user


def _owned_course(db: Session, cid: int, user: User) -> Course:
    """取课程并校验归属（行级隔离）；不存在 404，非本人 403。"""
    c = db.query(Course).filter(Course.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="课程不存在")
    if c.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="无权限操作该课程")
    return c


def _fmt(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else ""


def _json_loads(s):
    """安全解析 options 字段（存为 JSON 文本）；失败返回空列表。"""
    try:
        return json.loads(s) if s else []
    except (TypeError, ValueError):
        return []


# ---------------------------------------------------------------------------
# 课程与内容（§5.1）
# ---------------------------------------------------------------------------
class CourseIn(BaseModel):
    title: str
    code: str = ""
    teacher: str = ""
    cover: str = ""
    desc: str = ""
    category: str = ""


@router.get("/courses")
def list_courses(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_teacher(user)
    courses = db.query(Course).filter(Course.teacher_id == user.id).order_by(Course.id).all()
    return [{
        "id": c.id, "title": c.title, "code": c.code, "teacher": c.teacher,
        "cover": c.cover, "category": c.category, "desc": c.desc,
        "student_count": db.query(Enrollment).filter(Enrollment.course_id == c.id).count(),
    } for c in courses]


@router.post("/courses")
def create_course(body: CourseIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    require_teacher(user)
    c = Course(
        title=body.title, code=body.code, teacher=body.teacher or user.name,
        teacher_id=user.id, cover=body.cover or "📘",
        category=body.category or "通识课", desc=body.desc,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "title": c.title}


@router.put("/courses/{cid}")
def update_course(cid: int, body: CourseIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    require_teacher(user)
    c = _owned_course(db, cid, user)
    c.title = body.title
    c.code = body.code
    c.teacher = body.teacher or user.name
    c.cover = body.cover or c.cover
    c.category = body.category or c.category
    c.desc = body.desc
    db.commit()
    return {"ok": True}


@router.delete("/courses/{cid}")
def delete_course(cid: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    require_teacher(user)
    c = _owned_course(db, cid, user)
    _delete_course_cascade(db, c)
    return {"ok": True}


def _delete_course_cascade(db: Session, c: Course):
    """级联清理课程所有关联数据。"""
    cid = c.id
    db.query(Enrollment).filter(Enrollment.course_id == cid).delete(synchronize_session=False)
    db.query(SigninSession).filter(SigninSession.course_id == cid).delete(synchronize_session=False)
    sec_ids = [s.id for s in db.query(Section).filter(Section.course_id == cid).all()]
    if sec_ids:
        db.query(Question).filter(Question.section_id.in_(sec_ids)).delete(synchronize_session=False)
    db.query(Section).filter(Section.course_id == cid).delete(synchronize_session=False)
    hw_ids = [h.id for h in db.query(Homework).filter(Homework.course_id == cid).all()]
    if hw_ids:
        db.query(Submission).filter(Submission.homework_id.in_(hw_ids)).delete(synchronize_session=False)
    db.query(Homework).filter(Homework.course_id == cid).delete(synchronize_session=False)
    db.query(SignIn).filter(SignIn.course_id == cid).delete(synchronize_session=False)
    db.query(StudyLog).filter(StudyLog.course_id == cid).delete(synchronize_session=False)
    db.query(QuizResult).filter(QuizResult.course_id == cid).delete(synchronize_session=False)
    db.query(Announcement).filter(Announcement.course_id == cid).delete(synchronize_session=False)
    rooms = db.query(ChatRoom).filter(ChatRoom.course_id == cid).all()
    for r in rooms:
        db.query(ChatMember).filter(ChatMember.room_id == r.id).delete(synchronize_session=False)
        db.query(Message).filter(Message.room_id == r.id).delete(synchronize_session=False)
        db.delete(r)
    db.delete(c)
    db.commit()


@router.get("/courses/{cid}/sections")
def list_sections(cid: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    secs = db.query(Section).filter(Section.course_id == cid).order_by(Section.position).all()
    return [{"id": s.id, "title": s.title, "stype": s.stype,
             "content": s.content, "position": s.position,
             "question_count": db.query(Question).filter(Question.section_id == s.id).count()
             } for s in secs]


class SectionIn(BaseModel):
    title: str
    stype: str = "video"   # video / doc / quiz
    content: str = ""
    position: int = 0


@router.post("/courses/{cid}/sections")
def add_section(cid: int, body: SectionIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    require_teacher(user)
    c = _owned_course(db, cid, user)
    if body.stype not in ("video", "doc", "quiz"):
        raise HTTPException(400, "stype 必须是 video/doc/quiz")
    s = Section(course_id=cid, title=body.title, stype=body.stype,
                content=body.content, position=body.position)
    db.add(s)
    db.commit()
    db.refresh(s)
    # 学生端联动：课程新增章节 / 资料 / 测验，立刻出现在学生通知中心
    _STYPE_LABEL = {"video": "视频", "doc": "资料", "quiz": "章节测验"}
    _STYPE_TAB = {"video": "video", "doc": "doc", "quiz": "quiz"}
    notify_course_students(
        db, cid, kind="content",
        title="课程更新：《%s》新增%s" % (c.title, _STYPE_LABEL.get(body.stype, "章节")),
        body="「%s」已上线，可在课程页查看。" % (body.title or "新章节"),
        page="learn", tab=_STYPE_TAB.get(body.stype, "video"),
        ref_id=s.id, actor_id=user.id,
    )
    return {"id": s.id}


@router.put("/sections/{sid}")
def update_section(sid: int, body: SectionIn, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    require_teacher(user)
    s = db.query(Section).filter(Section.id == sid).first()
    if not s:
        raise HTTPException(404, "章节不存在")
    _owned_course(db, s.course_id, user)
    s.title = body.title
    s.stype = body.stype
    s.content = body.content
    s.position = body.position
    db.commit()
    return {"ok": True}


@router.delete("/sections/{sid}")
def delete_section(sid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_teacher(user)
    s = db.query(Section).filter(Section.id == sid).first()
    if not s:
        raise HTTPException(404, "章节不存在")
    _owned_course(db, s.course_id, user)
    if s.stype == "quiz":
        db.query(Question).filter(Question.section_id == sid).delete(synchronize_session=False)
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 测验出题（§5.1 补充）：quiz 章节下的题库增删改查
# ---------------------------------------------------------------------------
class QuestionIn(BaseModel):
    q_text: str
    options: list           # 选项文本数组，如 ["A...","B..."]
    answer: int = 0         # 正确选项下标
    explanation: str = ""


@router.get("/sections/{sid}/questions")
def list_questions(sid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """列出某测验章节的全部题目（教师端，含标准答案，供管理与编辑）。"""
    require_teacher(user)
    sec = db.query(Section).filter(Section.id == sid).first()
    if not sec:
        raise HTTPException(404, "章节不存在")
    _owned_course(db, sec.course_id, user)
    qs = db.query(Question).filter(Question.section_id == sid).order_by(Question.q_order).all()
    return [{
        "id": q.id, "q_order": q.q_order, "q_text": q.q_text,
        "options": _json_loads(q.options), "answer": q.answer,
        "explanation": q.explanation or "",
    } for q in qs]


@router.post("/sections/{sid}/questions")
def add_question(sid: int, body: QuestionIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    require_teacher(user)
    sec = db.query(Section).filter(Section.id == sid).first()
    if not sec:
        raise HTTPException(404, "章节不存在")
    _owned_course(db, sec.course_id, user)
    opts = [str(o) for o in (body.options or [])]
    if len(opts) < 2:
        raise HTTPException(400, "选项至少 2 个")
    if not body.q_text.strip():
        raise HTTPException(400, "题干不能为空")
    if body.answer < 0 or body.answer >= len(opts):
        raise HTTPException(400, "正确选项下标越界")
    last = db.query(Question).filter(Question.section_id == sid) \
        .order_by(Question.q_order.desc()).first()
    order = (last.q_order + 1) if last else 0
    q = Question(section_id=sid, q_order=order, q_text=body.q_text.strip(),
                 options=json.dumps(opts, ensure_ascii=False),
                 answer=body.answer, explanation=body.explanation)
    db.add(q)
    db.commit()
    db.refresh(q)
    return {"id": q.id, "q_order": q.q_order}


@router.put("/questions/{qid}")
def update_question(qid: int, body: QuestionIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    require_teacher(user)
    q = db.query(Question).filter(Question.id == qid).first()
    if not q:
        raise HTTPException(404, "题目不存在")
    sec = db.query(Section).filter(Section.id == q.section_id).first()
    _owned_course(db, sec.course_id, user)
    opts = [str(o) for o in (body.options or [])]
    if len(opts) < 2:
        raise HTTPException(400, "选项至少 2 个")
    if not body.q_text.strip():
        raise HTTPException(400, "题干不能为空")
    if body.answer < 0 or body.answer >= len(opts):
        raise HTTPException(400, "正确选项下标越界")
    q.q_text = body.q_text.strip()
    q.options = json.dumps(opts, ensure_ascii=False)
    q.answer = body.answer
    q.explanation = body.explanation
    db.commit()
    return {"ok": True}


@router.delete("/questions/{qid}")
def delete_question(qid: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    require_teacher(user)
    q = db.query(Question).filter(Question.id == qid).first()
    if not q:
        raise HTTPException(404, "题目不存在")
    sec = db.query(Section).filter(Section.id == q.section_id).first()
    _owned_course(db, sec.course_id, user)
    db.delete(q)
    # 重排后续题目序号，保持连续性
    rest = db.query(Question).filter(Question.section_id == q.section_id) \
        .order_by(Question.q_order).all()
    for i, r in enumerate(rest):
        r.q_order = i
    db.commit()
    return {"ok": True}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """上传视频/课件到 uploads/，返回可访问的 /files/<name>。"""
    require_teacher(user)
    if not file or not file.filename:
        raise HTTPException(400, "未收到文件")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1]
    saved = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, saved)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    return {"url": f"/files/{saved}", "name": saved}


# ---------------------------------------------------------------------------
# 学生名单（§5.2）
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Excel 导入：表头识别（与模板列名解耦，容忍“（必填）”、星号、空格、英文列名）
# ---------------------------------------------------------------------------
_HEADER_ALIASES = {
    "user": {"学号", "学生学号", "学籍号", "账号", "用户名", "username", "sid", "user", "studentid"},
    "name": {"姓名", "学生姓名", "名字", "name", "displayname", "studentname"},
    "klass": {"班级", "班级名称", "class", "classname"},
    "major": {"专业", "专业名称", "major"},
    "code": {"课程代码", "课程编号", "课程编码", "课程号", "code", "coursecode"},
    "title": {"课程名称", "课程名", "course", "coursetitle", "title"},
}


def _norm_header(h) -> str:
    """表头归一化：去括号说明、空白、星号、冒号，统一小写。"""
    s = str(h or "").strip().lower()
    s = re.sub(r"[（(][^)）]*[)）]", "", s)          # “学号（必填）” → “学号”
    s = re.sub(r"[\s\u3000*＊:：\-_/]+", "", s)      # “学 号*” → “学号”
    return s


def _map_headers(row) -> dict:
    """表头行 → {字段: 列下标}。

    注意：这里必须用 `in dict` 判断，不能用 `idx.get("学号") or ...`：
    当「学号」正好在第 0 列时下标是 0（假值），会被 or 误判为“没有该列”，
    正是之前导入报“缺少学号/姓名”的根因。
    """
    norm = [_norm_header(h) for h in row]
    out = {}
    for key, aliases in _HEADER_ALIASES.items():
        for i, h in enumerate(norm):
            if h and h in aliases:
                out[key] = i
                break
    return out


def _cell_text(v) -> str:
    """单元格 → 文本：Excel 里学号常被存成数字，避免出现 20240101.0。"""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


class StudentIn(BaseModel):
    username: str   # 学号
    name: str
    klass: str = ""
    major: str = ""
    course_id: int


@router.get("/courses/{cid}/students")
def list_students(cid: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    rows = (db.query(User, Enrollment)
            .join(Enrollment, Enrollment.student_id == User.id)
            .filter(Enrollment.course_id == cid).all())
    return [{
        "id": u.id, "username": u.username, "name": u.name,
        "klass": u.klass, "major": u.major,
    } for u, _ in rows]


@router.post("/students")
def add_student(body: StudentIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, body.course_id, user)
    stu = _upsert_student(db, body.username, body.name, body.klass, body.major)
    _ensure_enrollment(db, stu.id, body.course_id)
    return {"id": stu.id, "username": stu.username, "created": stu.id is not None}


@router.delete("/courses/{cid}/students/{uid}")
def remove_student(cid: int, uid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """仅移除选课关系，不删账号。"""
    require_teacher(user)
    _owned_course(db, cid, user)
    en = db.query(Enrollment).filter(
        Enrollment.course_id == cid, Enrollment.student_id == uid).first()
    if en:
        db.delete(en)
        db.commit()
    return {"ok": True}


def _upsert_student(db: Session, username: str, name: str, klass: str, major: str) -> User:
    """学生账号按学号判重：存在则更新资料，不存在则新建（默认密码=学号后6位）。"""
    username = (username or "").strip()
    name = (name or username or "").strip()
    if not username:
        raise HTTPException(400, "学号(用户名)不能为空")
    stu = db.query(User).filter(User.username == username).first()
    if stu:
        stu.name = name
        stu.klass = klass
        stu.major = major
    else:
        pwd = username[-6:] if len(username) >= 6 else username
        stu = User(username=username, name=name, klass=klass, major=major,
                   password_hash=hash_password(pwd), avatar=name[:1] or "学",
                   role="student")
        db.add(stu)
        db.flush()
    return stu


def _ensure_enrollment(db: Session, student_id: int, course_id: int):
    exists = db.query(Enrollment).filter(
        Enrollment.student_id == student_id, Enrollment.course_id == course_id).first()
    if not exists:
        db.add(Enrollment(student_id=student_id, course_id=course_id))
    db.commit()


@router.post("/students/import")
async def import_students(file: UploadFile = File(...),
                          course_id: Optional[int] = Form(None),
                          db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Excel 批量导入：按学号判重，建/补选课关系。

    课程匹配优先级：行内「课程代码」→ 行内「课程名称」→ 请求里的 course_id（当前课程）。
    这样教师在某个课程的「学生」页导入时，表格里即使只填学号/姓名也能直接进这门课。
    """
    require_teacher(user)
    if not file or not file.filename:
        raise HTTPException(400, "未收到文件")
    try:
        wb = load_workbook(io.BytesIO(await file.read()), data_only=True)
    except Exception:
        raise HTTPException(400, "无法解析 Excel 文件，请确认为 .xlsx 格式")

    # 默认目标课程：前端从当前课程页传入，先做归属校验
    default_course = None
    if course_id:
        default_course = _owned_course(db, int(course_id), user)

    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "表格为空")

    cols = _map_headers(rows[0])
    if "user" not in cols or "name" not in cols:
        found = "、".join(_cell_text(h) for h in rows[0] if _cell_text(h)) or "（表头为空）"
        raise HTTPException(
            400,
            "表头无法识别：需要「学号」「姓名」两列。当前第一行是：%s。"
            "请用「下载模板」得到的文件填写，或把表头改回「学号 / 姓名」。" % found,
        )

    created = updated = skipped = 0
    details = []          # 逐行说明：{row, student, type: error|skip, reason}，前端原样展示

    def _note(n, student, reason, kind="skip"):
        details.append({"row": n, "student": student, "type": kind, "reason": reason})
        return 1

    def _get(row, key):
        i = cols.get(key)
        return _cell_text(row[i]) if i is not None and i < len(row) else ""

    for n, r in enumerate(rows[1:], start=2):
        if r is None or all(_cell_text(c) == "" for c in r):
            continue                      # 整行为空（很常见，直接忽略而不是报错）
        username = _get(r, "user")
        if not username:
            skipped += _note(n, "", "学号为空", "error")
            continue
        name = _get(r, "name") or username
        code, title = _get(r, "code"), _get(r, "title")

        # 行内课程：只认「自己名下」的课，避免匹配到别的老师同名课程
        row_course = None
        if code:
            row_course = db.query(Course).filter(
                Course.code == code, Course.teacher_id == user.id).first()
        if not row_course and title:
            row_course = db.query(Course).filter(
                Course.title == title, Course.teacher_id == user.id).first()

        if default_course:
            # 从某门课的「学生」页导入：以当前课程为准；行内写了别的课要明确拒绝，
            # 否则学生会悄悄进到另一门课，老师在当前课程里看不到人（之前就踩过）。
            if row_course and row_course.id != default_course.id:
                skipped += _note(n, "%s %s" % (username, name),
                                 "表格里写的是《%s》，但正在导入《%s》，两者不一致，本行未导入"
                                 "（可删掉课程代码/名称两列，或改成当前课程）"
                                 % (row_course.title, default_course.title), "error")
                continue
            course = default_course
        else:
            course = row_course
            if not course:
                skipped += _note(n, "%s %s" % (username, name),
                                 "未匹配到课程：表格里填的课程代码「%s」/课程名称「%s」在本账号下不存在"
                                 % (code or "空", title or "空"), "error")
                continue

        existed = db.query(User).filter(User.username == username).first()
        stu = _upsert_student(db, username, name, _get(r, "klass"), _get(r, "major"))
        before = db.query(Enrollment).filter(
            Enrollment.student_id == stu.id, Enrollment.course_id == course.id).first()
        if before:
            skipped += _note(n, "%s %s" % (username, name),
                             "该学生已在《%s》名单中，无需重复加入" % course.title)
            continue
        _ensure_enrollment(db, stu.id, course.id)
        if existed:
            updated += 1
            details.append({"row": n, "student": "%s %s" % (username, name),
                            "type": "ok", "reason": "账号已存在，已加入《%s》" % course.title})
        else:
            created += 1
            pwd = username[-6:] if len(username) >= 6 else username
            details.append({"row": n, "student": "%s %s" % (username, name),
                            "type": "ok", "reason": "新建账号，已加入《%s》，初始密码 %s" % (course.title, pwd)})

    return {
        "created": created, "updated": updated, "skipped": skipped,
        "course": default_course.title if default_course else None,
        "details": details,
        "errors": [d for d in details if d["type"] == "error"],
    }


@router.get("/students/template")
def download_template(cid: Optional[int] = None,
                      user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    """下载学生导入模板。

    传 cid 时，示例行直接填上该课程的代码/名称，避免「课程代码对不上」这类失败。
    """
    require_teacher(user)
    wb = Workbook()
    ws = wb.active
    ws.title = "学生名单"
    ws.append(["学号", "姓名", "班级", "专业", "课程代码", "课程名称"])
    c = None
    if cid:
        c = db.query(Course).filter(Course.id == int(cid), Course.teacher_id == user.id).first()
    ws.append(["20240101", "张三", "24级1班", "计算机科学",
               (c.code if c and c.code else ""),     # 课程没有代码时不要瞎填 CS101，否则容易匹配错课
               (c.title if c else "数据科学导论")])
    # 列宽，方便老师填写
    for col, width in zip("ABCDEF", (14, 12, 14, 16, 14, 22)):
        ws.column_dimensions[col].width = width
    # 第二页：填写说明（很多导入失败都是没看规则）
    ws2 = wb.create_sheet("填写说明")
    for line in (
        ["学生名单导入说明"],
        ["1. 只在「学生名单」页填写，第一行表头不要修改。"],
        ["2. 「学号」「姓名」必填；班级、专业选填。"],
        ["3. 从某门课程的「学生」页下载模板并导入时，课程代码/课程名称可以留空，学生会直接进入当前课程。"],
        ["4. 一份表要导入多门课时，请填写课程代码或课程名称；与当前课程不一致的行会被跳过并给出原因。"],
        ["5. 已存在的学号不会覆盖密码，只会补充选课关系。"],
        ["6. 示例行「张三」请替换为真实学生，或直接删除该行。"],
    ):
        ws2.append(line)
    ws2.column_dimensions["A"].width = 110
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=student_template.xlsx"},
    )


# ---------------------------------------------------------------------------
# 作业批改（§5.3）
# ---------------------------------------------------------------------------
@router.get("/courses/{cid}/homeworks")
def list_homeworks(cid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    hws = db.query(Homework).filter(Homework.course_id == cid).order_by(Homework.id).all()
    out = []
    for h in hws:
        total = db.query(Submission).filter(Submission.homework_id == h.id).count()
        ungraded = db.query(Submission).filter(
            Submission.homework_id == h.id, Submission.status != "graded").count()
        out.append({"id": h.id, "title": h.title, "desc": h.desc, "due": h.due,
                    "submissions": total, "ungraded": ungraded})
    return out


@router.get("/homeworks/{hid}/submissions")
def list_submissions(hid: int, status: Optional[str] = None, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    require_teacher(user)
    hw = db.query(Homework).filter(Homework.id == hid).first()
    if not hw:
        raise HTTPException(404, "作业不存在")
    _owned_course(db, hw.course_id, user)
    q = db.query(Submission).filter(Submission.homework_id == hid)
    if status:
        q = q.filter(Submission.status == status)
    subs = q.all()
    out = []
    for s in subs:
        u = db.query(User).filter(User.id == s.user_id).first()
        out.append({
            "id": s.id, "user_id": s.user_id,
            "username": u.username if u else "", "name": u.name if u else "",
            "klass": u.klass if u else "",
            "answer": s.answer, "file_name": s.file_name,
            "file_path": s.file_path,
            "score": s.score, "feedback": s.feedback,
            "status": s.status, "submitted_at": _fmt(s.submitted_at),
            "graded_at": _fmt(s.graded_at),
        })
    return out


class GradeIn(BaseModel):
    score: str = ""
    feedback: str = ""


@router.post("/homework/{hid}/submissions/{sid}/grade")
def grade_submission(hid: int, sid: int, body: GradeIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    require_teacher(user)
    hw = db.query(Homework).filter(Homework.id == hid).first()
    if not hw:
        raise HTTPException(404, "作业不存在")
    _owned_course(db, hw.course_id, user)
    sub = db.query(Submission).filter(
        Submission.id == sid, Submission.homework_id == hid).first()
    if not sub:
        raise HTTPException(404, "提交记录不存在")
    sub.score = body.score
    sub.feedback = body.feedback
    sub.graded_at = datetime.utcnow()
    sub.status = "graded"
    db.commit()
    # 学生端联动：批改结果第一时间通知到本人
    course = db.query(Course).filter(Course.id == hw.course_id).first()
    notify_users(
        db, [sub.user_id], kind="grade",
        title="作业已批改：%s" % hw.title,
        body="《%s》%s%s" % (
            course.title if course else "课程",
            ("得分 " + body.score) if body.score else "教师已完成批改",
            ("　评语：" + body.feedback) if body.feedback else "",
        ),
        course_id=hw.course_id, page="learn", tab="homework",
        ref_id=hw.id, actor_id=user.id,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# 作业布置（§5.3 补充：原仅含批改，此处补充"布置/编辑/删除"）
# ---------------------------------------------------------------------------
class HomeworkIn(BaseModel):
    title: str
    desc: str = ""
    due: str = ""   # 截止时间（字符串，前端自行格式化）


@router.post("/courses/{cid}/homeworks")
def create_homework(cid: int, body: HomeworkIn, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_teacher(user)
    c = _owned_course(db, cid, user)
    if not body.title.strip():
        raise HTTPException(400, "作业标题不能为空")
    h = Homework(course_id=cid, title=body.title.strip(), desc=body.desc, due=body.due)
    db.add(h)
    db.commit()
    db.refresh(h)
    # 学生端联动：新作业提醒（含截止时间）
    notify_course_students(
        db, cid, kind="homework",
        title="新作业：%s" % h.title,
        body="《%s》%s%s" % (c.title,
                            ("截止 " + body.due + "。") if body.due else "",
                            (body.desc or "").strip()),
        page="learn", tab="homework", ref_id=h.id, actor_id=user.id,
    )
    return {"id": h.id, "title": h.title}


@router.put("/homeworks/{hid}")
def update_homework(hid: int, body: HomeworkIn, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_teacher(user)
    h = db.query(Homework).filter(Homework.id == hid).first()
    if not h:
        raise HTTPException(404, "作业不存在")
    c = _owned_course(db, h.course_id, user)
    changed = (h.title != (body.title.strip() or h.title)
               or (h.desc or "") != (body.desc or "")
               or (h.due or "") != (body.due or ""))
    h.title = body.title.strip() or h.title
    h.desc = body.desc
    h.due = body.due
    db.commit()
    # 学生端联动：仅在作业要求真的变化时才提醒，避免反复保存刷屏
    if changed:
        notify_course_students(
            db, h.course_id, kind="homework",
            title="作业要求更新：%s" % h.title,
            body="《%s》%s%s" % (c.title,
                                ("截止 " + (body.due or "") + "。") if body.due else "",
                                (body.desc or "").strip()),
            page="learn", tab="homework", ref_id=h.id, actor_id=user.id,
        )
    return {"ok": True}


@router.delete("/homeworks/{hid}")
def delete_homework(hid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    require_teacher(user)
    h = db.query(Homework).filter(Homework.id == hid).first()
    if not h:
        raise HTTPException(404, "作业不存在")
    _owned_course(db, h.course_id, user)
    db.query(Submission).filter(Submission.homework_id == hid).delete(synchronize_session=False)
    db.delete(h)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 班级学情看板（§5.4）
# ---------------------------------------------------------------------------
@router.get("/courses/{cid}/dashboard")
def course_dashboard(cid: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    students = (db.query(User).join(Enrollment, Enrollment.student_id == User.id)
                .filter(Enrollment.course_id == cid, User.role == "student").all())
    total = len(students)
    weekly = [0] * 7  # Mon..Sun 按学习秒数聚合
    details = []
    video_vals, hw_vals, quiz_vals = [], [], []
    signed_count = 0
    for stu in students:
        sl = db.query(StudyLog).filter(
            StudyLog.user_id == stu.id, StudyLog.course_id == cid).all()
        video = round(sum(s.progress for s in sl) / len(sl), 1) if sl else 0
        for s in sl:
            if s.last_at:
                weekly[s.last_at.weekday()] += s.watch_seconds or 0
        subs = (db.query(Submission).join(Homework, Submission.homework_id == Homework.id)
                .filter(Homework.course_id == cid, Submission.user_id == stu.id).all())
        scores = []
        for s in subs:
            try:
                scores.append(float(s.score))
            except (TypeError, ValueError):
                pass
        hw = round(sum(scores) / len(scores), 1) if scores else 0
        qr = db.query(QuizResult).filter(
            QuizResult.user_id == stu.id, QuizResult.course_id == cid).all()
        qv = [q.score / q.total * 100 for q in qr if q.total] if qr else []
        quiz = round(sum(qv) / len(qv), 1) if qv else 0
        signed = db.query(SignIn).filter(
            SignIn.user_id == stu.id, SignIn.course_id == cid).first() is not None
        if signed:
            signed_count += 1
        video_vals.append(video)
        hw_vals.append(hw)
        quiz_vals.append(quiz)
        details.append({
            "id": stu.id, "username": stu.username, "name": stu.name,
            "klass": stu.klass, "major": stu.major,
            "video": video, "homework": hw, "quiz": quiz, "signed": signed,
        })
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else 0
    return {
        "total_students": total,
        "avg_video": avg(video_vals),
        "avg_homework": avg(hw_vals),
        "avg_quiz": avg(quiz_vals),
        "signin_rate": round(signed_count / total * 100, 1) if total else 0,
        "weekly_watch_seconds": weekly,
        "students": details,
    }


# ---------------------------------------------------------------------------
# 签到管理（§5.5）
# ---------------------------------------------------------------------------
def _latest_session(db: Session, cid: int) -> Optional[SigninSession]:
    return (db.query(SigninSession).filter(SigninSession.course_id == cid)
            .order_by(SigninSession.opened_at.desc()).first())


@router.post("/courses/{cid}/signin/open")
def open_signin(cid: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    require_teacher(user)
    c = _owned_course(db, cid, user)
    sess = SigninSession(course_id=cid, opened_by=user.id)
    db.add(sess)
    db.commit()
    db.refresh(sess)
    # 学生端联动：签到窗口一开，学生端立即收到提醒（点击直达课堂签到页）
    notify_course_students(
        db, cid, kind="signin",
        title="课堂签到已开启",
        body="《%s》正在签到，请尽快到「课堂签到」完成签到。" % c.title,
        page="signin", ref_id=sess.id, actor_id=user.id,
    )
    return {"ok": True, "session_id": sess.id, "opened_at": _fmt(sess.opened_at)}


@router.post("/courses/{cid}/signin/close")
def close_signin(cid: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    sess = _latest_session(db, cid)
    if not sess or sess.closed_at:
        raise HTTPException(400, "当前没有进行中的签到")
    sess.closed_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "closed_at": _fmt(sess.closed_at)}


@router.get("/courses/{cid}/signin/list")
def signin_list(cid: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    sess = _latest_session(db, cid)
    opened_at = sess.opened_at if sess and not sess.closed_at else None
    rows = (db.query(User, Enrollment)
            .join(Enrollment, Enrollment.student_id == User.id)
            .filter(Enrollment.course_id == cid).all())
    out = []
    for u, _ in rows:
        sign = db.query(SignIn).filter(
            SignIn.user_id == u.id, SignIn.course_id == cid)
        if opened_at:
            sign = sign.filter(SignIn.created_at >= opened_at)
        rec = sign.order_by(SignIn.created_at.asc()).first()
        out.append({
            "id": u.id, "username": u.username, "name": u.name,
            "klass": u.klass, "major": u.major,
            "signed": bool(rec), "time": _fmt(rec.created_at) if rec else "",
        })
    return {"session_open": bool(opened_at), "students": out}


@router.get("/courses/{cid}/signin/export")
def signin_export(cid: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    sess = _latest_session(db, cid)
    opened_at = sess.opened_at if sess and not sess.closed_at else None
    rows = (db.query(User, Enrollment)
            .join(Enrollment, Enrollment.student_id == User.id)
            .filter(Enrollment.course_id == cid).all())
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["学号", "姓名", "班级", "专业", "状态", "签到时间"])
    for u, _ in rows:
        sign = db.query(SignIn).filter(SignIn.user_id == u.id, SignIn.course_id == cid)
        if opened_at:
            sign = sign.filter(SignIn.created_at >= opened_at)
        rec = sign.order_by(SignIn.created_at.asc()).first()
        writer.writerow([u.username, u.name, u.klass or "", u.major or "",
                         "已签到" if rec else "未签到",
                         _fmt(rec.created_at) if rec else ""])
    out.seek(0)
    return StreamingResponse(
        iter([out.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=signin_{cid}.csv"},
    )


# ---------------------------------------------------------------------------
# 公告（§5.6）
# ---------------------------------------------------------------------------
class AnnIn(BaseModel):
    title: str
    content: str = ""


@router.post("/courses/{cid}/announcements")
def create_announcement(cid: int, body: AnnIn, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    require_teacher(user)
    c = _owned_course(db, cid, user)
    a = Announcement(course_id=cid, author_id=user.id,
                     title=body.title, content=body.content)
    db.add(a)
    db.commit()
    db.refresh(a)
    # 学生端联动：公告是师生交互的主通道，必须推到每个学生的通知中心
    notify_course_students(
        db, cid, kind="announcement",
        title="新公告：%s" % a.title,
        body=(a.content or "").strip(),
        page="learn", tab="announcements", ref_id=a.id, actor_id=user.id,
    )
    return {"id": a.id}


@router.get("/courses/{cid}/announcements")
def list_announcements(cid: int, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    require_teacher(user)
    _owned_course(db, cid, user)
    items = db.query(Announcement).filter(Announcement.course_id == cid) \
        .order_by(Announcement.created_at.desc()).all()
    return [{
        "id": a.id, "title": a.title, "content": a.content,
        "created_at": _fmt(a.created_at),
    } for a in items]


@router.put("/announcements/{aid}")
def update_announcement(aid: int, body: AnnIn, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    require_teacher(user)
    a = db.query(Announcement).filter(Announcement.id == aid).first()
    if not a:
        raise HTTPException(404, "公告不存在")
    if a.author_id != user.id:
        raise HTTPException(403, "无权限编辑该公告")
    a.title = body.title
    a.content = body.content
    db.commit()
    # 学生端联动：公告内容变更同步提醒（kind 与新建一致，前端用同一图标）
    notify_course_students(
        db, a.course_id, kind="announcement",
        title="公告更新：%s" % a.title,
        body=(a.content or "").strip(),
        page="learn", tab="announcements", ref_id=a.id, actor_id=user.id,
    )
    return {"ok": True}


@router.delete("/announcements/{aid}")
def delete_announcement(aid: int, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    require_teacher(user)
    a = db.query(Announcement).filter(Announcement.id == aid).first()
    if not a:
        raise HTTPException(404, "公告不存在")
    if a.author_id != user.id:
        raise HTTPException(403, "无权限删除该公告")
    db.delete(a)
    db.commit()
    return {"ok": True}
