"""站内通知服务：教师端 ↔ 学生端 的交互通道。

设计要点
--------
1. **写时扇出（fan-out on write）**：一个课程事件（发布公告 / 布置作业 / 开启签到 /
   新增章节）在写入时展开成「每个收件人一行」，因此未读数和已读状态都是单表查询，
   不引入额外的关联表，也不会因为学生转班而丢失历史。
2. **收件人解析**：优先取该课程的选课名单；若课程还没导入名单（新建课程 / 演示环境），
   自动退化为「全部学生」，避免通知发出去却没人收到。
3. **双向**：`notify_course_students` 用于教师 → 学生；`notify_course_teacher` 用于
   学生 → 教师（交作业、发讨论），让教师端铃铛同样有实时反馈。
4. **容错**：通知写入失败绝不影响主业务（发公告、交作业本身必须成功），
   故所有 helper 内部吞掉异常并返回实际写入条数。
"""
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models import Notification, Enrollment, User, Course


def _clip(text: Optional[str], limit: int) -> str:
    s = (text or "").strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _student_ids(db: Session, course_id: int) -> list:
    ids = [r[0] for r in db.query(Enrollment.student_id)
           .filter(Enrollment.course_id == course_id).all()]
    if not ids:
        # 课程尚未导入名单：退化为全体学生（通识课默认公开可见）
        ids = [r[0] for r in db.query(User.id).filter(User.role == "student").all()]
    return ids


def notify_users(db: Session, user_ids: Iterable[int], *, kind: str, title: str,
                 body: str = "", course_id: Optional[int] = None,
                 page: Optional[str] = None, tab: Optional[str] = None,
                 ref_id: Optional[int] = None,
                 actor_id: Optional[int] = None) -> int:
    """向一批用户写入同一条通知，返回写入条数。"""
    try:
        uids = sorted({int(u) for u in user_ids if u})
        if not uids:
            return 0
        rows = [Notification(
            user_id=uid, actor_id=actor_id, course_id=course_id, kind=kind,
            title=_clip(title, 160), body=_clip(body, 2000),
            page=page, tab=tab, ref_id=ref_id,
        ) for uid in uids]
        db.add_all(rows)
        db.commit()
        return len(rows)
    except Exception as e:  # 通知是旁路能力，失败不得影响主流程
        db.rollback()
        print(f"⚠️ 通知写入失败（已忽略）：{e}")
        return 0


def notify_course_students(db: Session, course_id: int, *, kind: str, title: str,
                           body: str = "", page: str = "learn",
                           tab: Optional[str] = None, ref_id: Optional[int] = None,
                           actor_id: Optional[int] = None) -> int:
    """课程事件 → 该课程全体学生。"""
    return notify_users(db, _student_ids(db, course_id),
                        kind=kind, title=title, body=body, course_id=course_id,
                        page=page, tab=tab, ref_id=ref_id, actor_id=actor_id)


def notify_course_teacher(db: Session, course_id: int, *, kind: str, title: str,
                          body: str = "", tab: Optional[str] = None,
                          ref_id: Optional[int] = None,
                          actor_id: Optional[int] = None) -> int:
    """学生行为 → 该课程的任课教师（教师端铃铛）。"""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course or not course.teacher_id:
        return 0
    return notify_users(db, [course.teacher_id],
                        kind=kind, title=title, body=body, course_id=course_id,
                        page="t_courses", tab=tab, ref_id=ref_id, actor_id=actor_id)
